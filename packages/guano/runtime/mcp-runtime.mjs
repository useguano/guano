//#region src/lib/nodeState.ts
var BUILTIN_LIST_SOURCES = ["@pages"];
//#endregion
//#region src/lib/tree.ts
function deepClone(value) {
	return JSON.parse(JSON.stringify(value));
}
function walkNodes(nodes, visit) {
	for (const node of nodes) {
		visit(node);
		walkNodes(node.children, visit);
	}
}
function findNode(nodes, id) {
	for (const node of nodes) {
		if (node.id === id) return node;
		const match = findNode(node.children, id);
		if (match) return match;
	}
	return null;
}
function findParent(nodes, id) {
	for (const node of nodes) {
		if (node.children.some((child) => child.id === id)) return node;
		const match = findParent(node.children, id);
		if (match) return match;
	}
	return null;
}
function hasAncestorOfType(nodes, id, type) {
	for (const node of nodes) {
		if (node.type === type && findNode(node.children, id)) return true;
		if (hasAncestorOfType(node.children, id, type)) return true;
	}
	return false;
}
//#endregion
//#region src/lib/shared/instances.js
var isComponentType$1 = (type) => /^[A-Z]/.test(type);
/**
* @typedef {object} Mapping
* @property {object} master      the master node this page node stands for —
*                                where its classes, interactions and structure live
* @property {object} root        the root of that master's component
* @property {object} def         the component itself
* @property {string} instanceId  the id of the instance wrapper this node sits
*                                in: what makes a binding's state unique per instance
* @property {object[]} mirrors   nodes between this one and its master that may
*                                also carry its state, most specific first (the
*                                copies held by the components it is nested in)
* @property {Record<string,string>} picks  the instance's variant option per axis
*/
/**
* Map every node that lives in a component instance to its master, by
* structural position (index + type): the instance block on the page mirrors
* the master's tree, so the n-th child stands for the master's n-th child.
*
* COMPONENTS NEST. A master's tree may hold a node typed as another component
* — a nested instance, whose subtree there is a MIRROR: the inner component's
* structure, carrying only what this host says about it (its text, its picks,
* its hidden parts). So a page node inside `Card > Button` stands for a node
* of BUTTON's master — that is where its classes and interactions live — and
* the Card master's mirror of it sits in between, as the first place to look
* for anything the page node does not set itself.
*
* `roots` are the trees to walk — a page's elements, or (on the components
* board) each master's own children. `components` is the project's list; a
* name resolves to the FIRST component carrying it, as `findComponent` does.
*
* @returns {Map<string, Mapping>}
*/
function buildInstanceMap(roots, components) {
	const byName = /* @__PURE__ */ new Map();
	for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def);
	const map = /* @__PURE__ */ new Map();
	const walk = (inst, master, mirrors, scope) => {
		if (inst.type !== master.type) return;
		map.set(inst.id, {
			master,
			root: scope.def.root,
			def: scope.def,
			instanceId: scope.instanceId,
			mirrors,
			picks: scope.picks
		});
		if (master.slot) {
			visit(inst.children);
			return;
		}
		const length = Math.min(inst.children.length, master.children.length);
		for (let i = 0; i < length; i++) {
			const child = inst.children[i];
			const below = master.children[i];
			const childMirrors = mirrors.map((mirror) => mirror.children?.[i]).filter((mirror) => mirror && mirror.type === child.type);
			const inner = isComponentType$1(below.type) ? byName.get(below.type) : void 0;
			if (inner && inner !== scope.def && child.type === below.type) instance(child, inner, [...childMirrors, below]);
			else walk(child, below, childMirrors, scope);
		}
	};
	const instance = (wrapper, def, mirrors) => {
		walk(wrapper, def.root, mirrors, {
			def,
			instanceId: wrapper.id,
			picks: resolvePicks(def, wrapper, mirrors)
		});
	};
	const visit = (nodes) => {
		for (const node of nodes ?? []) {
			const def = isComponentType$1(node.type) ? byName.get(node.type) : void 0;
			if (def) instance(node, def, []);
			else visit(node.children);
		}
	};
	visit(roots);
	return map;
}
var isInstanceWrapper = (mapping) => !!mapping && mapping.master === mapping.root;
function nestedComponentNames(def) {
	const names = /* @__PURE__ */ new Set();
	const visit = (nodes) => {
		for (const node of nodes ?? []) if (isComponentType$1(node.type)) names.add(node.type);
		else visit(node.children);
	};
	visit(def.root.children);
	return [...names];
}
function componentReaches(components, from, to) {
	const byName = /* @__PURE__ */ new Map();
	for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def);
	const seen = /* @__PURE__ */ new Set();
	const visit = (name) => {
		if (name === to) return true;
		if (seen.has(name)) return false;
		seen.add(name);
		const def = byName.get(name);
		return !!def && nestedComponentNames(def).some(visit);
	};
	return visit(from);
}
function canNest(components, host, inner) {
	return host !== inner && !componentReaches(components, inner, host);
}
function dependencyOrder(components) {
	const byName = /* @__PURE__ */ new Map();
	for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def);
	const out = [];
	const state = /* @__PURE__ */ new Map();
	const visit = (def) => {
		if (state.has(def.name)) return;
		state.set(def.name, "open");
		for (const name of nestedComponentNames(def)) {
			const inner = byName.get(name);
			if (inner) visit(inner);
		}
		state.set(def.name, "done");
		out.push(def);
	};
	for (const def of components ?? []) visit(def);
	for (const def of components ?? []) if (!out.includes(def)) out.push(def);
	return out;
}
function resolvePicks(def, wrapper, mirrors) {
	const picks = {};
	for (const axis of def.variants ?? []) {
		let pick;
		for (const source of [wrapper, ...mirrors ?? []]) {
			const value = source?.variants?.[axis.name];
			if (value !== void 0 && axis.options.includes(value)) {
				pick = value;
				break;
			}
		}
		picks[axis.name] = pick ?? axis.default;
	}
	return picks;
}
function resolveInstanceValue(node, mapping, key) {
	if (node[key] !== void 0) return node[key];
	if (!mapping) return void 0;
	for (const mirror of mapping.mirrors) if (mirror[key] !== void 0) return mirror[key];
	return mapping.master[key];
}
function inheritedInstanceValue(mapping, key) {
	if (!mapping) return void 0;
	for (const mirror of mapping.mirrors) if (mirror[key] !== void 0) return mirror[key];
	return mapping.master[key];
}
function isNodeHidden(node, mapping) {
	return resolveInstanceValue(node, mapping, "hidden") === true;
}
function setNodeHidden(node, mapping, hidden) {
	if (hidden === (inheritedInstanceValue(mapping, "hidden") === true)) delete node.hidden;
	else node.hidden = hidden;
}
//#endregion
//#region src/lib/instances.ts
var buildInstanceMap$1 = buildInstanceMap;
var resolveInstanceValue$1 = resolveInstanceValue;
var isInstanceWrapper$1 = isInstanceWrapper;
var nestedComponentNames$1 = nestedComponentNames;
var canNest$1 = canNest;
var dependencyOrder$1 = dependencyOrder;
//#endregion
//#region src/lib/shared/ids.js
/**
* A v4-shaped unique id.
*
* `crypto.randomUUID` requires a SECURE CONTEXT. An editor served over plain
* http on a LAN address — `http://192.168.1.20:4174/admin`, the ordinary way a
* self-hosted instance is reached from a second machine — has none, and there
* every id-minting path throws: insert an element, create a component, add an
* entry. With no global error handler that was a white screen on first use.
*
* `crypto.getRandomValues` IS available in a non-secure context, which is why
* the fallback is that and not something weaker. There is deliberately no
* Math.random tier below it: an id collision inside a project tree is silent
* structural corruption, and if neither Web Crypto primitive exists the honest
* answer is to throw.
*
* The 36-character shape is kept so nothing that assumes the format breaks.
*
* @returns {string}
*/
function uid() {
	const c = globalThis.crypto;
	if (typeof c?.randomUUID === "function") return c.randomUUID();
	const b = /* @__PURE__ */ new Uint8Array(16);
	c.getRandomValues(b);
	b[6] = b[6] & 15 | 64;
	b[8] = b[8] & 63 | 128;
	const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
//#endregion
//#region src/lib/components.ts
function effectiveLinkChain(components) {
	const chain = /* @__PURE__ */ new Map();
	for (const def of components) {
		const mm = buildInstanceMap$1([def.root], components);
		walkNodes([def.root], (n) => {
			chain.set(n.id, resolveInstanceValue$1(n, mm.get(n.id), "link"));
		});
	}
	return chain;
}
function cloneForMaster(source) {
	const cloned = JSON.parse(JSON.stringify(source));
	const idMap = /* @__PURE__ */ new Map();
	walkNodes([cloned], (n) => {
		const next = uid();
		idMap.set(n.id, next);
		n.id = next;
		delete n.ref;
	});
	walkNodes([cloned], (n) => {
		for (const b of n.interactions ?? []) if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId);
		for (const b of n.animations ?? []) if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId);
	});
	return {
		cloned,
		idMap
	};
}
function stripExtractedInstanceState(source) {
	const strip = (n) => {
		if (!n.slot) n.children.forEach(strip);
		delete n.classes;
		delete n.interactions;
		delete n.animations;
		delete n.attributes;
		delete n.src;
		delete n.svg;
		delete n.hidden;
		delete n.channel;
		delete n.background;
		delete n.locales;
		delete n.content;
	};
	strip(source);
}
function isComponentType(type) {
	return /^[A-Z]/.test(type);
}
function createMirror(master) {
	const node = {
		id: uid(),
		type: master.type,
		content: "",
		children: master.slot ? cloneSlotContent(master.children) : master.children.map(createMirror)
	};
	if (master.arg) node.arg = master.arg;
	if (master.slot) node.slot = true;
	return node;
}
function cloneSlotContent(nodes) {
	const cloned = JSON.parse(JSON.stringify(nodes));
	const idMap = /* @__PURE__ */ new Map();
	walkNodes(cloned, (n) => {
		const next = uid();
		idMap.set(n.id, next);
		n.id = next;
		delete n.ref;
	});
	walkNodes(cloned, (n) => {
		for (const b of [...n.interactions ?? [], ...n.animations ?? []]) if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId);
	});
	return cloned;
}
function adoptCodeOwned(node, master, box, chain) {
	if ((node.arg ?? void 0) !== (master.arg ?? void 0)) {
		if (master.arg) node.arg = master.arg;
		else delete node.arg;
		box.moved = true;
	}
	const inherited = chain?.has(master.id) ? chain.get(master.id) : master.link;
	if (node.link !== void 0 && node.link === inherited) {
		delete node.link;
		box.moved = true;
	}
	if (!!node.slot !== !!master.slot) {
		if (master.slot) node.slot = true;
		else delete node.slot;
		box.moved = true;
	}
}
var INSTANCE_STATE_KEYS = [
	"content",
	"src",
	"svg",
	"background",
	"locales",
	"hidden",
	"variants",
	"link",
	"listQuery",
	"slider",
	"entryId",
	"fieldAttrs",
	"instanceAttributes",
	"htmlId",
	"ref"
];
function stateOn(node) {
	const keys = [];
	for (const key of INSTANCE_STATE_KEYS) {
		const value = node[key];
		if (value === void 0 || value === null || value === "" || value === false) continue;
		if (typeof value === "object" && !Object.keys(value).length) continue;
		keys.push(key === "locales" ? `locales(${Object.keys(value).join(", ")})` : key);
	}
	return keys;
}
function collectDiscarded(node, into) {
	const keys = stateOn(node);
	if (keys.length) into.push({
		type: node.type,
		keys
	});
	for (const child of node.children ?? []) collectDiscarded(child, into);
}
function alignLevel(node, master, box, chain) {
	if (master.slot) return;
	const old = node.children;
	const matches = lcsAlign$1(old.map(nodeSignature), master.children.map(nodeSignature));
	const used = new Set(matches.values());
	const freeOld = old.map((_, i) => i).filter((i) => !used.has(i));
	const freeNew = master.children.map((_, i) => i).filter((i) => !matches.has(i));
	if (freeOld.length && freeNew.length) {
		const weak = lcsAlign$1(freeOld.map((i) => old[i].type), freeNew.map((i) => master.children[i].type));
		for (const [nj, oj] of weak) matches.set(freeNew[nj], freeOld[oj]);
	}
	const next = master.children.map((child, i) => {
		const at = matches.get(i);
		const kept = at !== void 0 ? old[at] : createMirror(child);
		if (at === void 0) box.moved = true;
		adoptCodeOwned(kept, child, box, chain);
		alignLevel(kept, child, box, chain);
		return kept;
	});
	if (box.lost) {
		const reused = new Set(matches.values());
		for (let i = 0; i < old.length; i++) if (!reused.has(i)) collectDiscarded(old[i], box.lost);
	}
	if (next.length !== old.length || next.some((child, i) => child !== old[i])) {
		node.children = next;
		box.moved = true;
	}
}
function alignStructure(instance, master, chain, lost) {
	const box = {
		moved: false,
		lost
	};
	alignLevel(instance, master, box, chain);
	return box.moved;
}
function alignMirror(mirror, master, chain) {
	const box = { moved: false };
	adoptCodeOwned(mirror, master, box, chain);
	alignLevel(mirror, master, box, chain);
	return box.moved;
}
function alignHostMirrors(host, components, chain) {
	let moved = false;
	const visit = (nodes) => {
		for (const node of nodes) {
			if (!isComponentType(node.type)) {
				visit(node.children);
				continue;
			}
			const inner = components.find((c) => c.name === node.type);
			if (inner && inner !== host && alignMirror(node, inner.root, chain)) moved = true;
		}
	};
	visit(host.root.children);
	return moved;
}
function nestedWrappers(def, name) {
	const out = [];
	const visit = (nodes) => {
		for (const node of nodes) if (!isComponentType(node.type)) visit(node.children);
		else if (!name || node.type === name) out.push(node);
	};
	visit(def.root.children);
	return out;
}
function normalizeComponentName(raw, taken) {
	const cleaned = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
	const base = /^[A-Za-z]/.test(cleaned) ? cleaned : `C${cleaned}`;
	const name = base.charAt(0).toUpperCase() + base.slice(1) || "Component";
	if (!taken.includes(name)) return name;
	let n = 2;
	while (taken.includes(`${name}${n}`)) n++;
	return `${name}${n}`;
}
function nodeSignature(node) {
	return `${node.type}|${node.arg ?? ""}|${node.link ?? ""}`;
}
function lcsAlign$1(a, b) {
	const n = a.length;
	const m = b.length;
	const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const map = /* @__PURE__ */ new Map();
	let i = 0;
	let j = 0;
	while (i < n && j < m) if (a[i] === b[j]) {
		map.set(j, i);
		i++;
		j++;
	} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
	else j++;
	return map;
}
function adoptStructure(master, edited, selfName, result = {
	adopted: 0,
	created: 0,
	orphaned: []
}) {
	const masterChildren = master.children;
	const editedChildren = edited.children.filter((child) => child.type !== selfName);
	const matches = lcsAlign$1(masterChildren.map(nodeSignature), editedChildren.map(nodeSignature));
	const weakSignature = (n) => `${n.type}|${n.arg ?? ""}`;
	const freeMaster = masterChildren.map((_, i) => i).filter((i) => ![...matches.values()].includes(i));
	const freeEdited = editedChildren.map((_, i) => i).filter((i) => !matches.has(i));
	if (freeMaster.length && freeEdited.length) {
		const weak = lcsAlign$1(freeMaster.map((i) => weakSignature(masterChildren[i])), freeEdited.map((i) => weakSignature(editedChildren[i])));
		for (const [ej, mj] of weak) matches.set(freeEdited[ej], freeMaster[mj]);
	}
	const usedMaster = new Set(matches.values());
	master.children = editedChildren.map((child, ei) => {
		const mi = matches.get(ei);
		let node;
		if (mi !== void 0) {
			node = masterChildren[mi];
			result.adopted++;
		} else {
			node = {
				id: uid(),
				type: child.type,
				content: child.content,
				locales: child.locales ? JSON.parse(JSON.stringify(child.locales)) : void 0,
				attributes: child.attributes ? JSON.parse(JSON.stringify(child.attributes)) : void 0,
				children: []
			};
			result.created++;
		}
		if (child.arg) node.arg = child.arg;
		else delete node.arg;
		if (child.link) node.link = child.link;
		else delete node.link;
		adoptStructure(node, child, selfName, result);
		return node;
	});
	masterChildren.forEach((m, mi) => {
		if (usedMaster.has(mi)) return;
		result.orphaned.push({
			id: m.id,
			type: m.type,
			hadClasses: !!m.classes?.trim(),
			hadInteractions: (m.interactions?.length ?? 0) + (m.animations?.length ?? 0)
		});
	});
	return result;
}
//#endregion
//#region src/lib/shared/elements.js
var ELEMENTS_DATA = {
	body: {
		tag: "div",
		suggest: "section"
	},
	section: {
		tag: "section",
		suggest: "div"
	},
	div: {
		tag: "div",
		suggest: "h2"
	},
	container: {
		tag: "div",
		suggest: "div"
	},
	grid: {
		tag: "div",
		suggest: "div"
	},
	header: {
		tag: "header",
		suggest: "nav"
	},
	footer: {
		tag: "footer",
		suggest: "text"
	},
	article: {
		tag: "article",
		suggest: "h2"
	},
	nav: {
		tag: "nav",
		suggest: "link"
	},
	main: {
		tag: "main",
		suggest: "section"
	},
	aside: {
		tag: "aside",
		suggest: "h3"
	},
	text: {
		tag: "div",
		defaultContent: "Lorem ipsum"
	},
	h1: {
		tag: "h1",
		defaultContent: "Lorem ipsum"
	},
	h2: {
		tag: "h2",
		defaultContent: "Lorem ipsum"
	},
	h3: {
		tag: "h3",
		defaultContent: "Lorem ipsum"
	},
	h4: {
		tag: "h4",
		defaultContent: "Lorem ipsum"
	},
	h5: {
		tag: "h5",
		defaultContent: "Lorem ipsum"
	},
	h6: {
		tag: "h6",
		defaultContent: "Lorem ipsum"
	},
	heading: {
		tag: "h2",
		defaultContent: "Lorem ipsum"
	},
	label: {
		tag: "label",
		suggest: "span",
		seed: {
			type: "span",
			content: "Label"
		}
	},
	paragraph: {
		tag: "p",
		defaultContent: "Dolor sit amet"
	},
	span: {
		tag: "span",
		defaultContent: "Dolor sit amet"
	},
	blockquote: {
		tag: "blockquote",
		suggest: "paragraph"
	},
	figure: {
		tag: "figure",
		suggest: "image"
	},
	figcaption: {
		tag: "figcaption",
		defaultContent: "Caption"
	},
	list: {
		tag: "ul",
		suggest: "list-item"
	},
	"list-item": {
		tag: "li",
		suggest: "text"
	},
	image: {
		tag: "img",
		void: true
	},
	icon: {
		tag: "svg",
		void: true
	},
	video: { tag: "video" },
	form: {
		tag: "form",
		suggest: "input"
	},
	"form-success": {
		tag: "div",
		suggest: "text"
	},
	"form-error": {
		tag: "div",
		suggest: "text"
	},
	input: {
		tag: "input",
		void: true
	},
	textarea: { tag: "textarea" },
	checkbox: {
		tag: "input",
		void: true,
		attrs: { type: "checkbox" }
	},
	radio: {
		tag: "input",
		void: true,
		attrs: { type: "radio" }
	},
	fieldset: {
		tag: "fieldset",
		suggest: "legend"
	},
	legend: {
		tag: "legend",
		defaultContent: "Legend"
	},
	dropdown: {
		tag: "select",
		suggest: "option"
	},
	select: {
		tag: "select",
		suggest: "option"
	},
	option: {
		tag: "option",
		defaultContent: "Option"
	},
	button: {
		tag: "button",
		suggest: "span",
		seed: {
			type: "span",
			content: "Button"
		}
	},
	link: {
		tag: "a",
		suggest: "span",
		seed: {
			type: "span",
			content: "Link"
		}
	},
	table: {
		tag: "table",
		suggest: "thead"
	},
	thead: {
		tag: "thead",
		suggest: "tr"
	},
	tbody: {
		tag: "tbody",
		suggest: "tr"
	},
	tr: {
		tag: "tr",
		suggest: "td"
	},
	th: {
		tag: "th",
		suggest: "text"
	},
	td: {
		tag: "td",
		suggest: "text"
	},
	"collection-list": {
		tag: "div",
		suggest: "div"
	},
	"list-empty": {
		tag: "div",
		suggest: "text"
	},
	"collection-item": {
		tag: "div",
		defaultContent: ""
	},
	"custom-code": {
		tag: "div",
		defaultContent: ""
	},
	slider: {
		tag: "div",
		suggest: "div"
	}
};
//#endregion
//#region src/lib/shared/forms.js
var FIELD_CAPS = {
	text: 1e3,
	email: 254,
	tel: 40,
	url: 2048,
	number: 40,
	textarea: 1e4,
	select: 200,
	checkbox: 200,
	radio: 200
};
var CONTROL_KINDS = {
	input: "text",
	textarea: "textarea",
	select: "select",
	dropdown: "select",
	checkbox: "checkbox",
	radio: "radio"
};
var INPUT_TYPE_KINDS = {
	email: "email",
	tel: "tel",
	url: "url",
	number: "number",
	text: "text",
	search: "text",
	password: "text",
	radio: "radio",
	checkbox: "checkbox"
};
var FORM_STATE_TYPES = ["form-success", "form-error"];
var isFormControl = (type) => Object.hasOwn(CONTROL_KINDS, type);
function collectFormFields(formNode, resolve, opts) {
	const fields = [];
	const unnamed = [];
	const seen = /* @__PURE__ */ new Map();
	const attrsOf = (node) => resolve ? resolve(node) ?? {} : node.attributes ?? {};
	const contentOf = (node) => (opts && opts.content ? opts.content(node) : void 0) ?? node.content ?? "";
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		if (node !== formNode && node.type === "form") return;
		if (FORM_STATE_TYPES.includes(node.type)) return;
		if (node !== formNode && opts && opts.hidden && opts.hidden(node)) return;
		if (isFormControl(node.type)) {
			const attrs = attrsOf(node);
			const name = String(attrs.name ?? "").trim();
			if (!name) unnamed.push({
				id: node.id,
				type: node.type
			});
			else if (name.startsWith("_")) unnamed.push({
				id: node.id,
				type: node.type,
				reserved: true,
				name
			});
			else {
				const kind = kindFor(node, attrs);
				const field = {
					name,
					kind,
					required: attrs.required === "" || attrs.required === "required" || attrs.required === "true",
					maxLength: capFor(kind, attrs.maxlength)
				};
				if (kind === "select") field.options = optionValues(node, attrsOf, contentOf);
				if (kind === "radio" || kind === "checkbox") field.value = String(attrs.value ?? "on");
				const prior = seen.get(name);
				if (prior) {
					if (prior.kind === "radio" && kind === "radio") prior.options = [.../* @__PURE__ */ new Set([...prior.options ?? [], field.value])];
					else prior.duplicate = true;
				} else {
					if (kind === "radio") field.options = [field.value];
					seen.set(name, field);
					fields.push(field);
				}
			}
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(formNode);
	return {
		fields,
		unnamed,
		duplicates: fields.filter((f) => f.duplicate).map((f) => f.name)
	};
}
function kindFor(node, attrs) {
	const base = CONTROL_KINDS[node.type] ?? "text";
	if (node.type !== "input") return base;
	return INPUT_TYPE_KINDS[String(attrs.type ?? "text").toLowerCase()] ?? "text";
}
function capFor(kind, maxlength) {
	const ceiling = FIELD_CAPS[kind] ?? FIELD_CAPS.text;
	const own = Number(maxlength);
	return Number.isFinite(own) && own > 0 ? Math.min(own, ceiling) : ceiling;
}
function optionValues(node, attrsOf, contentOf) {
	const out = [];
	for (const child of node.children ?? []) {
		if (child.type !== "option") continue;
		const value = attrsOf(child).value ?? contentOf(child);
		out.push(String(value ?? ""));
	}
	return out;
}
function isInternalRoute(value) {
	const text = String(value ?? "");
	if (!text) return true;
	if (!text.startsWith("/")) return false;
	if (text.startsWith("//")) return false;
	if (/[\\]/.test(text)) return false;
	try {
		if (new URL(text, "https://x.invalid").origin !== "https://x.invalid") return false;
	} catch {
		return false;
	}
	return true;
}
function formConfigError(config) {
	if (!config || typeof config !== "object") return null;
	if (config.redirect && !isInternalRoute(config.redirect)) return "redirect must be a path on this site, like /thanks";
	if (config.name !== void 0 && String(config.name).length > 80) return "a form name is at most 80 characters";
	if (config.externalAction) {
		if (config.enabled) return "a form cannot both accept submissions here and post to another service";
		try {
			if (new URL(config.externalAction).protocol !== "https:") return "the external action must be an https:// URL";
		} catch {
			return "the external action must be an https:// URL";
		}
	}
	return null;
}
var formEnabled = (config) => !!config && config.enabled === true;
var formName = (config) => {
	return String(config?.name ?? "").trim() || "Form";
};
//#endregion
//#region src/lib/elements.ts
var ELEMENTS = ELEMENTS_DATA;
function isKnownElement(type) {
	return type in ELEMENTS;
}
function isLeafElement(type) {
	const def = ELEMENTS[type];
	return !!def && (def.defaultContent !== void 0 || def.void === true);
}
function isInstancePart(type) {
	return isLeafElement(type) || isFormControl(type) || type === "link" || type === "button";
}
function createNode(type) {
	return {
		id: uid(),
		type,
		content: "",
		children: []
	};
}
var TYPE_GROUPS = [
	[
		"section",
		"div",
		"header",
		"footer",
		"article",
		"nav",
		"main",
		"aside",
		"list-item"
	],
	[
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6"
	],
	[
		"text",
		"paragraph",
		"span"
	],
	[
		"button",
		"link",
		"label"
	],
	["list", "form"],
	["thead", "tbody"],
	["th", "td"]
];
function typeOptionsFor(type) {
	return TYPE_GROUPS.find((group) => group.includes(type)) ?? [];
}
//#endregion
//#region src/lib/shared/tokens.js
var TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/;
var HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
var RESERVED_TOKEN_NAMES = /* @__PURE__ */ new Set([
	"slate",
	"gray",
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"emerald",
	"teal",
	"cyan",
	"sky",
	"blue",
	"indigo",
	"violet",
	"purple",
	"fuchsia",
	"pink",
	"rose",
	"neutral",
	"stone",
	"zinc",
	"white",
	"black",
	"transparent",
	"current",
	"inherit"
]);
/**
* Why a token is malformed, or null. Shadowing a palette name is NOT malformed —
* see isReservedToken.
* @returns {string|null}
*/
function tokenError(token) {
	if (!TOKEN_NAME_RE.test(token?.name ?? "")) return "token names are kebab-case ([a-z][a-z0-9-]*)";
	if (!HEX_RE.test(token?.value ?? "")) return "token values are #hex colours";
	return null;
}
function isReservedToken(name) {
	return RESERVED_TOKEN_NAMES.has(String(name));
}
function isValidToken(token) {
	return tokenError(token) === null && !isReservedToken(token.name);
}
function isEmittableToken(token) {
	return tokenError(token) === null;
}
var LENGTH_RE = /^-?\d*\.?\d+(?:px|rem|em|%|vw|vh|ch|ex|pt)?$/;
var FUNC_RE = /^(?:clamp|calc|min|max)\([-+*/\s\d.a-z%(),]*\)$/i;
function isThemeValue(value) {
	const v = String(value ?? "").trim();
	if (!v || v.length > 64) return false;
	if (v.includes(";") || v.includes("}") || v.includes("{")) return false;
	return LENGTH_RE.test(v) || FUNC_RE.test(v);
}
//#endregion
//#region src/lib/shared/fonts.js
var FORMAT_BY_EXT = {
	woff2: "woff2",
	woff: "woff",
	ttf: "truetype",
	otf: "opentype",
	ttc: "truetype"
};
var FONT_FORMATS = [
	"woff2",
	"woff",
	"truetype",
	"opentype"
];
function fontFormatForUrl(url) {
	return FORMAT_BY_EXT[String(url ?? "").toLowerCase().split(/[?#]/)[0].split(".").pop()];
}
var FONT_FAMILY_RE$1 = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;
var WEIGHT_RE$1 = /^(?:[1-9]00|normal|bold)(?: (?:[1-9]00))?$/;
var SAFE_FONT_SRC = /^(?:\/|https:\/\/)/i;
function fontError(font, others = []) {
	const family = String(font?.family ?? "").trim();
	if (!family) return "Family name required";
	if (!FONT_FAMILY_RE$1.test(family)) return "Letters, digits, spaces and hyphens only";
	if (others.some((f) => f !== font && String(f.family ?? "").trim().toLowerCase() === family.toLowerCase() && (f.weight ?? "400") === (font.weight ?? "400") && (f.style ?? "normal") === (font.style ?? "normal"))) return "Another font already uses this family, weight and style";
	if (!font?.src) return "Pick a font file";
	if (!SAFE_FONT_SRC.test(font.src)) return "Font files must be a /media/… path or an https:// URL";
	if (font.weight && !WEIGHT_RE$1.test(String(font.weight))) return "Weight is 100–900, or a range like \"100 900\"";
	return null;
}
//#endregion
//#region src/lib/settings.ts
function defaultSettings() {
	return {
		favicon: void 0,
		publishing: {
			method: "server",
			github: {
				repo: "",
				branch: "main"
			},
			apiOrigin: ""
		},
		seo: {
			siteName: "",
			titleTemplate: "%s",
			description: "",
			ogImage: void 0
		},
		domain: "",
		tokens: [],
		customCode: { head: "" },
		fonts: {
			family: "",
			googleFontsUrl: void 0,
			custom: []
		}
	};
}
//#endregion
//#region src/lib/factories.ts
function defaultBreakpoints() {
	return [
		{
			id: uid(),
			name: "Desktop",
			width: 1440,
			height: 900
		},
		{
			id: uid(),
			name: "Tablet",
			width: 768,
			height: 1024
		},
		{
			id: uid(),
			name: "Mobile",
			width: 390,
			height: 844
		}
	];
}
function createBody(arg) {
	const body = createNode("body");
	if (arg) body.arg = arg;
	return body;
}
function createPage(name, path, _locale = "en") {
	const now = Date.now();
	return {
		id: uid(),
		name,
		path,
		status: "published",
		elements: [createBody()],
		createdAt: now,
		updatedAt: now
	};
}
function createProject(name) {
	return {
		id: uid(),
		name,
		schemaVersion: 2,
		pages: [createPage("Home", "/")],
		components: [],
		collections: [],
		interactions: [],
		animations: [],
		breakpoints: defaultBreakpoints(),
		comments: [],
		locales: ["en"],
		defaultLocale: "en",
		settings: defaultSettings()
	};
}
//#endregion
//#region src/lib/html/tags.ts
var TAG_OF = {
	body: "body",
	paragraph: "p",
	link: "a",
	list: "ul",
	"list-item": "li",
	image: "img",
	icon: "svg",
	text: "div",
	checkbox: "input",
	radio: "input",
	"collection-list": "collection-list",
	"collection-item": "collection-item",
	"list-empty": "list-empty",
	slider: "slider",
	"form-success": "form-success",
	"form-error": "form-error",
	"custom-code": "custom-code"
};
var ALIAS_OF = {
	container: "div",
	grid: "div",
	heading: "h2",
	dropdown: "select"
};
var SLOT_FILL_TYPE = "@slot";
function tagForType(type) {
	if (isComponentType(type)) return type;
	const canonical = ALIAS_OF[type] ?? type;
	return TAG_OF[canonical] ?? canonical;
}
var TYPE_OF_TAG = (() => {
	const out = {};
	for (const type of Object.keys(ELEMENTS)) {
		if (ALIAS_OF[type]) continue;
		const tag = tagForType(type);
		if (out[tag] === void 0) out[tag] = type;
	}
	out.div = "div";
	out.input = "input";
	out.select = "select";
	return out;
})();
function sameType(a, b) {
	if (a === b) return true;
	return (ALIAS_OF[a] ?? a) === (ALIAS_OF[b] ?? b);
}
function typeForTag(tag, attrs, components) {
	if (isComponentType(tag)) return { type: tag };
	if (tag === "input") {
		const kind = attrs.type;
		if (kind === "checkbox" || kind === "radio") return { type: kind };
		return { type: "input" };
	}
	if (tag === "div" && attrs["data-type"] === "text") return { type: "text" };
	if (tag === "slot") return { type: SLOT_FILL_TYPE };
	const known = TYPE_OF_TAG[tag];
	if (known) return { type: known };
	const matches = components.filter((name) => name.toLowerCase() === tag.toLowerCase());
	if (matches.length === 1) return {
		type: matches[0],
		note: `<${tag}> read as the component <${matches[0]}> — component tags are capitalized`
	};
	return null;
}
var VOID_TAGS = /* @__PURE__ */ new Set([
	"img",
	"input",
	"br",
	"hr",
	"meta",
	"link",
	"source"
]);
var isLenientVoidTag = (tag) => !isComponentType(tag) && VOID_TAGS.has(tag);
var FORBIDDEN_TAGS = /* @__PURE__ */ new Set([
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"base"
]);
var isLeafType = (type) => !isComponentType(type) && isLeafElement(type);
var isRenderableType = (type) => type === "@slot" || isComponentType(type) || isKnownElement(type);
var SOURCE_TYPES = /* @__PURE__ */ new Set([
	"collection-list",
	"collection-item",
	"slider",
	"body"
]);
var impliedAttrs = (type) => !isComponentType(type) && ELEMENTS[type]?.attrs || {};
//#endregion
//#region src/lib/legacy/dsl.ts
var REF = "(?:#(?<ref>[a-zA-Z][a-zA-Z0-9-]?[a-zA-Z0-9-]*)?)?";
var NAME = "[a-zA-Z][a-zA-Z0-9-]*";
var ARG = "(?:\\[(?<arg>[a-z0-9.@+-]*)\\]?)?";
var MARKERS = "(?:\\(\\+?\\)?)?(?:\\{\\+?\\}?)?";
var LINK = "(?:@(?<link>\\S+))?";
var LEAF = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}:${LINK}$`);
var OPEN = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}${LINK}$`);
var CLOSE = /^([a-zA-Z][a-zA-Z0-9-]*):$/;
var slots = (m) => {
	const g = m.groups;
	return {
		name: g.name,
		ref: g.ref,
		arg: g.arg,
		link: g.link
	};
};
function lexLine(text) {
	const tokens = [];
	let i = 0;
	while (i < text.length) {
		let j = i;
		if (text[j] === ":") {
			j++;
			while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			if (text[j] === "#") {
				j++;
				while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			}
			if (text[j] === "[") {
				j++;
				while (j < text.length && text[j] !== "]") j++;
				if (text[j] === "]") j++;
			}
			while (text[j] === "(" || text[j] === "{" || text[j] === "+" || text[j] === ")" || text[j] === "}") j++;
			if (text[j] === ":") {
				const next = text[j + 1];
				if (!next || !/[a-zA-Z]/.test(next)) j++;
				else if (text.slice(j).match(/^:[a-zA-Z][a-zA-Z0-9-]*[:[(@{]/)) {} else j++;
			}
			if (text[j] === "@") {
				j++;
				while (j < text.length && !/\s/.test(text[j])) j++;
			}
		} else {
			while (j < text.length && /[a-zA-Z0-9-]/.test(text[j])) j++;
			if (text[j] === ":") j++;
		}
		if (j === i) j++;
		tokens.push(text.slice(i, j));
		i = j;
	}
	return tokens;
}
function parseLegacyCode(code) {
	const root = [];
	const stack = [];
	const append = (node) => {
		const parent = stack[stack.length - 1];
		(parent ? parent.children : root).push(node);
	};
	const make = (name, m) => {
		const { ref, arg, link } = slots(m);
		const node = createNode(name);
		if (arg && arg !== "+") node.arg = arg;
		if (ref) node.ref = ref;
		if (link) node.link = link === "item" ? "@item" : link;
		return node;
	};
	for (const line of code.split("\n")) for (const token of lexLine(line.trim())) {
		const leaf = token.match(LEAF);
		if (leaf) {
			const { name } = slots(leaf);
			if (isKnownElement(name) || isComponentType(name)) append(make(name, leaf));
			continue;
		}
		const open = token.match(OPEN);
		if (open) {
			const { name } = slots(open);
			if (isKnownElement(name) || isComponentType(name)) {
				const node = make(name, open);
				append(node);
				stack.push(node);
			}
			continue;
		}
		const close = token.match(CLOSE);
		if (close) {
			for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === close[1]) {
				stack.length = i;
				break;
			}
		}
	}
	return root;
}
//#endregion
//#region src/lib/migrate.ts
var SCHEMA_VERSION = 2;
var emptyReport = () => ({
	changed: false,
	from: 1,
	pages: 0,
	collapsed: {},
	materialized: 0,
	salvaged: [],
	textDisagreed: []
});
function migrateProject(project, opts = {}) {
	const report = emptyReport();
	if (!project || !Array.isArray(project.pages)) return {
		project,
		report
	};
	report.from = project.schemaVersion ?? 1;
	if (report.from >= 2) return {
		project,
		report
	};
	const components = project.components ?? [];
	const byName = /* @__PURE__ */ new Map();
	for (const def of components) if (!byName.has(def.name)) byName.set(def.name, def);
	const collapse = (node) => {
		const target = ALIAS_OF[node.type];
		if (!target) return;
		report.collapsed[node.type] = (report.collapsed[node.type] ?? 0) + 1;
		node.type = target;
	};
	const dropDsl = (node) => {
		collapse(node);
		delete node.line;
		delete node.endLine;
	};
	const materialize = (node) => {
		if (!isComponentType(node.type) || node.children.length) return;
		const def = byName.get(node.type);
		if (!def?.root.children.length) return;
		alignStructure(node, def.root);
		report.materialized++;
	};
	for (const page of project.pages) {
		report.pages++;
		let body = (page.elements ?? []).find((n) => n.type === "body");
		if (!body) {
			body = (page.code ? parseLegacyCode(page.code) : []).find((n) => n.type === "body");
			if (body) {
				page.elements = [body];
				report.salvaged.push(page.name || page.id);
			} else {
				body = createBody();
				page.elements = [body];
				report.salvaged.push(`${page.name || page.id} (empty)`);
			}
		} else if (page.elements.length > 1) page.elements = [body];
		if (opts.pageToCode && page.code) {
			if (opts.pageToCode(page, project.defaultLocale || "en") !== page.code) report.textDisagreed.push(page.name || page.id);
		}
		walkNodes([body], materialize);
		walkNodes([body], dropDsl);
		delete page.code;
	}
	for (const def of components) walkNodes([def.root], dropDsl);
	project.schemaVersion = 2;
	report.changed = true;
	return {
		project,
		report
	};
}
function describeMigration(key, report) {
	if (!report.changed) return null;
	const bits = [`${report.pages} page${report.pages === 1 ? "" : "s"}`];
	const collapsed = Object.entries(report.collapsed);
	if (collapsed.length) bits.push(`collapsed ${collapsed.map(([t, n]) => `${n}×${t}`).join(", ")}`);
	if (report.materialized) bits.push(`materialized ${report.materialized} instance(s)`);
	if (report.textDisagreed.length) bits.push(`${report.textDisagreed.length} page(s) whose stored DSL disagreed with the tree (the tree wins)`);
	if (report.salvaged.length) bits.push(`SALVAGED from DSL: ${report.salvaged.join(", ")}`);
	return `${key}: v${report.from} → v2 — ${bits.join("; ")}`;
}
//#endregion
//#region src/lib/shared/attributes.js
var ATTR_ALLOW = /* @__PURE__ */ new Set([
	"target",
	"rel",
	"download",
	"title",
	"role",
	"type",
	"name",
	"value",
	"placeholder",
	"alt",
	"loading",
	"tabindex",
	"lang",
	"dir",
	"hidden",
	"sizes",
	"disabled",
	"open",
	"for",
	"required",
	"readonly",
	"checked",
	"selected",
	"multiple",
	"autofocus",
	"autocomplete",
	"min",
	"max",
	"step",
	"rows",
	"cols",
	"maxlength",
	"minlength",
	"pattern",
	"inputmode",
	"accept",
	"translate"
]);
var ATTR_PREFIXES = ["data-", "aria-"];
var RESERVED_DATA_ATTRS = /* @__PURE__ */ new Set([
	"data-form",
	"data-form-redirect",
	"data-form-success",
	"data-form-error",
	"data-form-fallback",
	"data-fx",
	"data-int",
	"data-anim",
	"data-tgt",
	"data-atgt",
	"data-slider",
	"data-channel",
	"data-node-id",
	"data-id",
	"data-ref",
	"data-type",
	"data-source"
]);
var RESERVED_DATA_PREFIXES = ["data-sl-", "data-form-"];
var NAME_RE = /^[a-z][a-z0-9-]*$/;
function isReservedAttribute(name) {
	const n = String(name).toLowerCase().trim();
	return RESERVED_DATA_ATTRS.has(n) || RESERVED_DATA_PREFIXES.some((p) => n.startsWith(p));
}
function isAllowedAttribute(name) {
	const n = String(name).toLowerCase().trim();
	if (!NAME_RE.test(n)) return false;
	if (isReservedAttribute(n)) return false;
	if (ATTR_ALLOW.has(n)) return true;
	return ATTR_PREFIXES.some((p) => n.startsWith(p) && n.length > p.length);
}
function sanitizeAttributes(record) {
	/** @type {Record<string, string>} */
	const out = {};
	if (!record || typeof record !== "object" || Array.isArray(record)) return out;
	for (const [rawName, rawValue] of Object.entries(record)) {
		const name = String(rawName).toLowerCase().trim();
		if (!isAllowedAttribute(name)) continue;
		if (rawValue === false) continue;
		out[name] = rawValue == null || rawValue === true ? "" : String(rawValue);
	}
	return out;
}
var LOCALIZABLE_ATTRS = [
	"placeholder",
	"aria-label",
	"alt",
	"title",
	"data-prev-label",
	"data-next-label",
	"data-dots-label",
	"data-dot-label"
];
function isLocalizableAttribute(name) {
	return LOCALIZABLE_ATTRS.includes(String(name).toLowerCase().trim());
}
function mergeAttributeLayers(shared, instance, localeAttrs) {
	const out = { ...shared ?? {} };
	for (const [name, value] of Object.entries(instance ?? {})) out[name] = value;
	for (const [name, value] of Object.entries(localeAttrs ?? {})) if (isLocalizableAttribute(name) && String(value) !== "") out[name] = value;
	return out;
}
/**
* The attributes a node renders, resolved along the WHOLE instance chain.
*
* `mergeAttributeLayers` knows two layers, which is right for a node placed
* directly on a page: the master's shared set, then this placement's own. It is
* not enough once components NEST. A host holds a mirror of the component it
* nests, and that mirror is where the host says what it has to say about that
* placement — a Card's two `OptionCard` radios each needing their own `name`,
* which is the only way they form separate radio groups.
*
* Every reader took `node.instanceAttributes` and the master's and stopped, so
* a write to a mirror was stored, read back, and rendered NOWHERE: the tool
* answered `{saved: true, edited: 4}` and every radio on the published page
* still carried the component's default name, which quietly made four
* questions one radio group. Same bug class as a class on an instance wrapper,
* and the same fix: resolve where the renderers resolve everything else.
*
* Weakest first: the master's shared set, each host mirror from least to most
* specific (`mapping.mirrors` runs most-specific first), this node's own
* placement layer, then the locale's text overrides.
*
* @param {object} node the page (or master) node being rendered
* @param {{master: object, mirrors: object[]}|null|undefined} mapping
* @param {Record<string,string>|undefined} localeAttrs already narrowed to the
*        locale being rendered (absent on the default locale)
*/
function resolveNodeAttributes(node, mapping, localeAttrs) {
	if (!mapping) return mergeAttributeLayers(node?.attributes, node?.instanceAttributes, localeAttrs);
	const out = { ...mapping.master?.attributes ?? {} };
	for (let i = (mapping.mirrors?.length ?? 0) - 1; i >= 0; i--) for (const [name, value] of Object.entries(mapping.mirrors[i]?.instanceAttributes ?? {})) out[name] = value;
	return mergeAttributeLayers(out, node?.instanceAttributes, localeAttrs);
}
//#endregion
//#region src/lib/colors.ts
var TAILWIND_SHADES = [
	"50",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900"
];
var TAILWIND_COLORS = {
	slate: [
		"#f8fafc",
		"#f1f5f9",
		"#e2e8f0",
		"#cbd5e1",
		"#94a3b8",
		"#64748b",
		"#475569",
		"#334155",
		"#1e293b",
		"#0f172a"
	],
	gray: [
		"#f9fafb",
		"#f3f4f6",
		"#e5e7eb",
		"#d1d5db",
		"#9ca3af",
		"#6b7280",
		"#4b5563",
		"#374151",
		"#1f2937",
		"#111827"
	],
	red: [
		"#fef2f2",
		"#fee2e2",
		"#fecaca",
		"#fca5a5",
		"#f87171",
		"#ef4444",
		"#dc2626",
		"#b91c1c",
		"#991b1b",
		"#7f1d1d"
	],
	orange: [
		"#fff7ed",
		"#ffedd5",
		"#fed7aa",
		"#fdba74",
		"#fb923c",
		"#f97316",
		"#ea580c",
		"#c2410c",
		"#9a3412",
		"#7c2d12"
	],
	amber: [
		"#fffbeb",
		"#fef3c7",
		"#fde68a",
		"#fcd34d",
		"#fbbf24",
		"#f59e0b",
		"#d97706",
		"#b45309",
		"#92400e",
		"#78350f"
	],
	yellow: [
		"#fefce8",
		"#fef9c3",
		"#fef08a",
		"#fde047",
		"#facc15",
		"#eab308",
		"#ca8a04",
		"#a16207",
		"#854d0e",
		"#713f12"
	],
	lime: [
		"#f7fee7",
		"#ecfccb",
		"#d9f99d",
		"#bef264",
		"#a3e635",
		"#84cc16",
		"#65a30d",
		"#4d7c0f",
		"#3f6212",
		"#365314"
	],
	green: [
		"#f0fdf4",
		"#dcfce7",
		"#bbf7d0",
		"#86efac",
		"#4ade80",
		"#22c55e",
		"#16a34a",
		"#15803d",
		"#166534",
		"#14532d"
	],
	emerald: [
		"#ecfdf5",
		"#d1fae5",
		"#a7f3d0",
		"#6ee7b7",
		"#34d399",
		"#10b981",
		"#059669",
		"#047857",
		"#065f46",
		"#064e3b"
	],
	teal: [
		"#f0fdfa",
		"#ccfbf1",
		"#99f6e4",
		"#5eead4",
		"#2dd4bf",
		"#14b8a6",
		"#0d9488",
		"#0f766e",
		"#115e59",
		"#134e4a"
	],
	cyan: [
		"#ecfeff",
		"#cffafe",
		"#a5f3fc",
		"#67e8f9",
		"#22d3ee",
		"#06b6d4",
		"#0891b2",
		"#0e7490",
		"#155e75",
		"#164e63"
	],
	sky: [
		"#f0f9ff",
		"#e0f2fe",
		"#bae6fd",
		"#7dd3fc",
		"#38bdf8",
		"#0ea5e9",
		"#0284c7",
		"#0369a1",
		"#075985",
		"#0c4a6e"
	],
	blue: [
		"#eff6ff",
		"#dbeafe",
		"#bfdbfe",
		"#93c5fd",
		"#60a5fa",
		"#3b82f6",
		"#2563eb",
		"#1d4ed8",
		"#1e40af",
		"#1e3a8a"
	],
	indigo: [
		"#eef2ff",
		"#e0e7ff",
		"#c7d2fe",
		"#a5b4fc",
		"#818cf8",
		"#6366f1",
		"#4f46e5",
		"#4338ca",
		"#3730a3",
		"#312e81"
	],
	violet: [
		"#f5f3ff",
		"#ede9fe",
		"#ddd6fe",
		"#c4b5fd",
		"#a78bfa",
		"#8b5cf6",
		"#7c3aed",
		"#6d28d9",
		"#5b21b6",
		"#4c1d95"
	],
	purple: [
		"#faf5ff",
		"#f3e8ff",
		"#e9d5ff",
		"#d8b4fe",
		"#c084fc",
		"#a855f7",
		"#9333ea",
		"#7e22ce",
		"#6b21a8",
		"#581c87"
	],
	fuchsia: [
		"#fdf4ff",
		"#fae8ff",
		"#f5d0fe",
		"#f0abfc",
		"#e879f9",
		"#d946ef",
		"#c026d3",
		"#a21caf",
		"#86198f",
		"#701a75"
	],
	pink: [
		"#fdf2f8",
		"#fce7f3",
		"#fbcfe8",
		"#f9a8d4",
		"#f472b6",
		"#ec4899",
		"#db2777",
		"#be185d",
		"#9d174d",
		"#831843"
	],
	rose: [
		"#fff1f2",
		"#ffe4e6",
		"#fecdd3",
		"#fda4af",
		"#fb7185",
		"#f43f5e",
		"#e11d48",
		"#be123c",
		"#9f1239",
		"#881337"
	]
};
var TOKEN_HEX = {};
function isPaletteColor(value) {
	if (value in TOKEN_HEX) return true;
	const match = value.match(/^([a-z]+)-(\d{2,3})$/);
	return !!match && match[1] in TAILWIND_COLORS && TAILWIND_SHADES.includes(match[2]);
}
//#endregion
//#region src/lib/valueClass.ts
var ACCEPTED_UNITS = [
	"px",
	"rem",
	"em",
	"%",
	"ch",
	"ex",
	"fr"
];
var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
new RegExp(`^\\d*\\.?\\d+(?:${ACCEPTED_UNITS.map(esc).join("|")})$`);
var TAIL_RE = /^(?:\[.+\]|\d+(?:\.\d+)?)$/;
function buildTailClass(prefix, tail) {
	if (tail.startsWith("-")) return `-${prefix}-${tail.slice(1)}`;
	return `${prefix}-${tail}`;
}
function parseTail(token, prefix, opts = {}) {
	let neg = false;
	let rest;
	if (token.startsWith(`-${prefix}-`)) {
		neg = true;
		rest = token.slice(prefix.length + 2);
	} else if (token.startsWith(`${prefix}-`)) rest = token.slice(prefix.length + 1);
	else return null;
	if (!neg && opts.allowKeywords?.includes(rest)) return rest;
	if (!TAIL_RE.test(rest)) return null;
	return neg ? `-${rest}` : rest;
}
function sizeClassToText(prefix, token) {
	if (!token || !token.startsWith(`${prefix}-`)) return "";
	const rest = token.slice(prefix.length + 1);
	return rest.startsWith("[") && rest.endsWith("]") ? rest.slice(1, -1) : rest;
}
var LEN_RE = /^\d*\.?\d+(?:px|rem|em|%)$/;
var TRACK_RE = /^-?\d*\.?\d+(?:em|rem|px)$/;
var WEIGHT_RE = /^(?:[1-9]\d{0,2}|1000)$/;
function matchesNamedFormat(format, text) {
	switch (format) {
		case "length": return LEN_RE.test(text);
		case "line-height": return /^\d*\.?\d+$/.test(text) || LEN_RE.test(text);
		case "tracking": return TRACK_RE.test(text);
		case "weight": return WEIGHT_RE.test(text);
	}
}
function isNamedValueClass(prefix, format, known, token) {
	if (known.includes(token)) return true;
	if (!token.startsWith(`${prefix}-`)) return false;
	return matchesNamedFormat(format, sizeClassToText(prefix, token));
}
function derivePrefix(classes) {
	if (!classes.length) return null;
	const parts = classes.map((c) => {
		const stripped = c.replace(/^-/, "");
		const i = stripped.lastIndexOf("-");
		return i === -1 ? null : [stripped.slice(0, i), stripped.slice(i + 1)];
	});
	if (parts.some((p) => p === null)) return null;
	const pre = parts[0][0];
	if (!parts.every((p) => p[0] === pre)) return null;
	if (!parts.every((p) => /^\d+(?:\.\d+)?$/.test(p[1]))) return null;
	return pre;
}
//#endregion
//#region src/lib/tieredBox.ts
var SPACING = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"6",
	"8",
	"10",
	"12",
	"16",
	"20",
	"24"
];
var borderWidthScheme = {
	steps: [
		"0",
		"1",
		"2",
		"4",
		"8"
	],
	slot: (base, s) => s === "all" ? base : `${base}-${s}`,
	className: (prefix, step) => step === "1" ? prefix : buildTailClass(prefix, step),
	parse: (token, prefix) => {
		if (token === prefix) return "1";
		return parseTail(token, prefix);
	}
};
//#endregion
//#region src/lib/styleCatalog.ts
var FLEX = ["flex", "inline-flex"];
var GRID = ["grid", "inline-grid"];
var FLEX_GRID = [...FLEX, ...GRID];
var inFlex = {
	when: "display",
	values: FLEX
};
var inGrid = {
	when: "display",
	values: GRID
};
var inFlexGrid = {
	when: "display",
	values: FLEX_GRID
};
var childOfFlex = {
	when: "parentDisplay",
	values: FLEX
};
var childOfGrid = {
	when: "parentDisplay",
	values: GRID
};
var childOfFlexGrid = {
	when: "parentDisplay",
	values: FLEX_GRID
};
var positioned = { when: "positioned" };
var whenTransition = { when: "transition" };
var whenMediaOrBg = { when: "mediaOrBackground" };
var OPACITY = [
	"0",
	"10",
	"20",
	"30",
	"40",
	"50",
	"60",
	"70",
	"80",
	"90",
	"100"
];
var sel = (pairs) => ({
	kind: "select",
	options: pairs.map(([label, cls]) => ({
		label,
		class: cls
	}))
});
var slide = (prefix, stops = SPACING) => ({
	kind: "slider",
	prefix,
	stops
});
var slideC = (pairs, custom) => ({
	kind: "slider",
	classes: pairs.map(([, cls]) => cls),
	labels: pairs.map(([label]) => label),
	...custom ? { custom } : {}
});
var signed = (prefix, mags) => {
	const neg = [...mags].reverse().map((m) => [`-${m}`, `-${prefix}-${m}`]);
	const pos = mags.map((m) => [m, `${prefix}-${m}`]);
	return slideC([
		...neg,
		["0", `${prefix}-0`],
		...pos
	]);
};
var col = (prefix) => ({
	kind: "color",
	prefix
});
var inp = (prefix, placeholder) => ({
	kind: "input",
	prefix,
	placeholder
});
var ico = (opts) => ({
	kind: "icons",
	options: opts.map(([label, cls, icon]) => ({
		label,
		class: cls,
		icon
	}))
});
var STYLE_SECTIONS = [
	{
		id: "layout",
		label: "Layout",
		properties: [
			{
				id: "display",
				label: "Display",
				control: ico([
					[
						"Block",
						"block",
						"Square"
					],
					[
						"Inline",
						"inline",
						"Baseline"
					],
					[
						"Flex",
						"flex",
						"StretchHorizontal"
					],
					[
						"Grid",
						"grid",
						"Grid3x3"
					],
					[
						"None",
						"hidden",
						"Ban"
					]
				])
			},
			{
				id: "direction",
				label: "Direction",
				needsDisplay: true,
				relevance: inFlex,
				control: ico([
					[
						"Row",
						"flex-row",
						"ArrowRight"
					],
					[
						"Column",
						"flex-col",
						"ArrowDown"
					],
					[
						"Row reverse",
						"flex-row-reverse",
						"ArrowLeft"
					],
					[
						"Col reverse",
						"flex-col-reverse",
						"ArrowUp"
					]
				])
			},
			{
				id: "align",
				label: "Align items",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: ico([
					[
						"Start",
						"items-start",
						"AlignStartHorizontal"
					],
					[
						"Center",
						"items-center",
						"AlignCenterHorizontal"
					],
					[
						"End",
						"items-end",
						"AlignEndHorizontal"
					],
					[
						"Stretch",
						"items-stretch",
						"StretchVertical"
					],
					[
						"Baseline",
						"items-baseline",
						"Baseline"
					]
				])
			},
			{
				id: "justify",
				label: "Justify",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: ico([
					[
						"Start",
						"justify-start",
						"AlignStartVertical"
					],
					[
						"Center",
						"justify-center",
						"AlignCenterVertical"
					],
					[
						"End",
						"justify-end",
						"AlignEndVertical"
					],
					[
						"Between",
						"justify-between",
						"AlignHorizontalSpaceBetween"
					],
					[
						"Around",
						"justify-around",
						"AlignHorizontalSpaceAround"
					],
					[
						"Evenly",
						"justify-evenly",
						"AlignHorizontalDistributeCenter"
					]
				])
			},
			{
				id: "align-content",
				label: "Align content",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: ico([
					[
						"Start",
						"content-start",
						"AlignStartHorizontal"
					],
					[
						"Center",
						"content-center",
						"AlignCenterHorizontal"
					],
					[
						"End",
						"content-end",
						"AlignEndHorizontal"
					],
					[
						"Between",
						"content-between",
						"AlignVerticalSpaceBetween"
					],
					[
						"Around",
						"content-around",
						"AlignVerticalSpaceAround"
					],
					[
						"Evenly",
						"content-evenly",
						"AlignVerticalDistributeCenter"
					]
				])
			},
			{
				id: "gap",
				label: "Gap",
				needsDisplay: true,
				relevance: inFlexGrid,
				control: slide("gap")
			},
			{
				id: "flex",
				label: "Flex",
				relevance: childOfFlex,
				control: ico([
					[
						"1",
						"flex-1",
						"ChevronsLeftRight"
					],
					[
						"Auto",
						"flex-auto",
						"Expand"
					],
					[
						"Initial",
						"flex-initial",
						"Minimize2"
					],
					[
						"None",
						"flex-none",
						"Ban"
					]
				])
			},
			{
				id: "grow",
				label: "Grow",
				relevance: childOfFlex,
				control: ico([[
					"Grow",
					"grow",
					"Maximize2"
				], [
					"No grow",
					"grow-0",
					"Ban"
				]])
			},
			{
				id: "shrink",
				label: "Shrink",
				relevance: childOfFlex,
				control: ico([[
					"Shrink",
					"shrink",
					"Shrink"
				], [
					"No shrink",
					"shrink-0",
					"Ban"
				]])
			},
			{
				id: "order",
				label: "Order",
				relevance: childOfFlexGrid,
				control: inp("order", "1, first, last…"),
				default: "order-1"
			},
			{
				id: "grid-cols",
				label: "Grid cols",
				relevance: inGrid,
				control: slideC([
					["1", "grid-cols-1"],
					["2", "grid-cols-2"],
					["3", "grid-cols-3"],
					["4", "grid-cols-4"],
					["5", "grid-cols-5"],
					["6", "grid-cols-6"],
					["12", "grid-cols-12"]
				])
			},
			{
				id: "grid-rows",
				label: "Grid rows",
				relevance: inGrid,
				control: slide("grid-rows", [
					"1",
					"2",
					"3",
					"4",
					"5",
					"6"
				])
			},
			{
				id: "col-span",
				label: "Col span",
				relevance: childOfGrid,
				control: slideC([
					["1", "col-span-1"],
					["2", "col-span-2"],
					["3", "col-span-3"],
					["4", "col-span-4"],
					["5", "col-span-5"],
					["6", "col-span-6"],
					["Full", "col-span-full"]
				])
			},
			{
				id: "row-span",
				label: "Row span",
				relevance: childOfGrid,
				control: slideC([
					["1", "row-span-1"],
					["2", "row-span-2"],
					["3", "row-span-3"],
					["4", "row-span-4"],
					["5", "row-span-5"],
					["6", "row-span-6"],
					["Full", "row-span-full"]
				])
			},
			{
				id: "self",
				label: "Self align",
				relevance: childOfFlexGrid,
				control: ico([
					[
						"Auto",
						"self-auto",
						"Dot"
					],
					[
						"Start",
						"self-start",
						"AlignStartHorizontal"
					],
					[
						"Center",
						"self-center",
						"AlignCenterHorizontal"
					],
					[
						"End",
						"self-end",
						"AlignEndHorizontal"
					],
					[
						"Stretch",
						"self-stretch",
						"StretchVertical"
					]
				])
			},
			{
				id: "justify-self",
				label: "Justify self",
				relevance: childOfGrid,
				control: ico([
					[
						"Auto",
						"justify-self-auto",
						"Dot"
					],
					[
						"Start",
						"justify-self-start",
						"AlignStartVertical"
					],
					[
						"Center",
						"justify-self-center",
						"AlignCenterVertical"
					],
					[
						"End",
						"justify-self-end",
						"AlignEndVertical"
					],
					[
						"Stretch",
						"justify-self-stretch",
						"StretchHorizontal"
					]
				])
			}
		]
	},
	{
		id: "position",
		label: "Position",
		properties: [
			{
				id: "position",
				label: "Position",
				control: sel([
					["Static", "static"],
					["Relative", "relative"],
					["Absolute", "absolute"],
					["Fixed", "fixed"],
					["Sticky", "sticky"]
				])
			},
			{
				id: "top",
				label: "Top",
				control: slide("top"),
				relevance: positioned
			},
			{
				id: "right",
				label: "Right",
				control: slide("right"),
				relevance: positioned
			},
			{
				id: "bottom",
				label: "Bottom",
				control: slide("bottom"),
				relevance: positioned
			},
			{
				id: "left",
				label: "Left",
				control: slide("left"),
				relevance: positioned
			},
			{
				id: "z-index",
				label: "Z-index",
				control: slide("z", [
					"0",
					"10",
					"20",
					"30",
					"40",
					"50"
				]),
				relevance: positioned
			}
		]
	},
	{
		id: "size",
		label: "Size",
		properties: [
			{
				id: "width",
				label: "Width",
				control: inp("w", "full, 64, 1/2…")
			},
			{
				id: "height",
				label: "Height",
				control: inp("h", "full, 64, screen…")
			},
			{
				id: "min-width",
				label: "Min width",
				control: inp("min-w", "0, full…")
			},
			{
				id: "max-width",
				label: "Max width",
				control: inp("max-w", "sm, md, xl…")
			},
			{
				id: "min-height",
				label: "Min height",
				control: inp("min-h", "0, screen…")
			},
			{
				id: "max-height",
				label: "Max height",
				control: inp("max-h", "full, screen…")
			},
			{
				id: "overflow",
				label: "Overflow",
				control: ico([
					[
						"Visible",
						"overflow-visible",
						"Eye"
					],
					[
						"Hidden",
						"overflow-hidden",
						"EyeOff"
					],
					[
						"Scroll",
						"overflow-scroll",
						"Scroll"
					],
					[
						"Auto",
						"overflow-auto",
						"MoveVertical"
					]
				])
			}
		]
	},
	{
		id: "spacing",
		label: "Spacing",
		properties: [{
			id: "padding",
			label: "Padding",
			control: slide("p")
		}, {
			id: "margin",
			label: "Margin",
			control: slide("m")
		}]
	},
	{
		id: "text",
		label: "Text",
		properties: [
			{
				id: "text-color",
				label: "Color",
				control: col("text")
			},
			{
				id: "font-family",
				label: "Font",
				control: sel([
					["Sans", "font-sans"],
					["Serif", "font-serif"],
					["Mono", "font-mono"]
				])
			},
			{
				id: "font-size",
				label: "Size",
				control: slideC([
					["XS", "text-xs"],
					["SM", "text-sm"],
					["Base", "text-base"],
					["LG", "text-lg"],
					["XL", "text-xl"],
					["2XL", "text-2xl"],
					["3XL", "text-3xl"],
					["4XL", "text-4xl"],
					["5XL", "text-5xl"],
					["6XL", "text-6xl"],
					["7XL", "text-7xl"],
					["8XL", "text-8xl"],
					["9XL", "text-9xl"]
				], {
					prefix: "text",
					format: "length"
				})
			},
			{
				id: "font-weight",
				label: "Weight",
				control: slideC([
					["Thin", "font-thin"],
					["Extralight", "font-extralight"],
					["Light", "font-light"],
					["Normal", "font-normal"],
					["Medium", "font-medium"],
					["Semibold", "font-semibold"],
					["Bold", "font-bold"],
					["Extrabold", "font-extrabold"],
					["Black", "font-black"]
				], {
					prefix: "font",
					format: "weight"
				})
			},
			{
				id: "text-align",
				label: "Align",
				control: ico([
					[
						"Left",
						"text-left",
						"AlignLeft"
					],
					[
						"Center",
						"text-center",
						"AlignCenter"
					],
					[
						"Right",
						"text-right",
						"AlignRight"
					],
					[
						"Justify",
						"text-justify",
						"AlignJustify"
					]
				])
			},
			{
				id: "line-height",
				label: "Line height",
				control: slideC([
					["None", "leading-none"],
					["Tight", "leading-tight"],
					["Snug", "leading-snug"],
					["Normal", "leading-normal"],
					["Relaxed", "leading-relaxed"],
					["Loose", "leading-loose"]
				], {
					prefix: "leading",
					format: "line-height"
				})
			},
			{
				id: "letter-spacing",
				label: "Letter spacing",
				control: slideC([
					["Tighter", "tracking-tighter"],
					["Tight", "tracking-tight"],
					["Normal", "tracking-normal"],
					["Wide", "tracking-wide"],
					["Wider", "tracking-wider"],
					["Widest", "tracking-widest"]
				], {
					prefix: "tracking",
					format: "tracking"
				})
			},
			{
				id: "text-transform",
				label: "Transform",
				control: ico([
					[
						"Uppercase",
						"uppercase",
						"CaseUpper"
					],
					[
						"Lowercase",
						"lowercase",
						"CaseLower"
					],
					[
						"Capitalize",
						"capitalize",
						"CaseSensitive"
					],
					[
						"Normal",
						"normal-case",
						"Ban"
					]
				])
			},
			{
				id: "text-decoration",
				label: "Decoration",
				control: ico([
					[
						"Underline",
						"underline",
						"Underline"
					],
					[
						"Overline",
						"overline",
						"Minus"
					],
					[
						"Line through",
						"line-through",
						"Strikethrough"
					],
					[
						"None",
						"no-underline",
						"Ban"
					]
				])
			},
			{
				id: "word-break",
				label: "Word break",
				control: ico([
					[
						"Normal",
						"break-normal",
						"AlignJustify"
					],
					[
						"Words",
						"break-words",
						"WrapText"
					],
					[
						"All",
						"break-all",
						"ChevronsLeftRight"
					],
					[
						"Keep",
						"break-keep",
						"Ban"
					]
				])
			},
			{
				id: "list-style",
				label: "List",
				control: ico([
					[
						"None",
						"list-none",
						"Ban"
					],
					[
						"Disc",
						"list-disc",
						"List"
					],
					[
						"Decimal",
						"list-decimal",
						"ListOrdered"
					]
				])
			}
		]
	},
	{
		id: "background",
		label: "Background",
		properties: [
			{
				id: "bg-color",
				label: "Color",
				control: col("bg")
			},
			{
				id: "object-fit",
				label: "Object fit",
				relevance: whenMediaOrBg,
				control: sel([
					["Contain", "object-contain"],
					["Cover", "object-cover"],
					["Fill", "object-fill"],
					["None", "object-none"],
					["Scale down", "object-scale-down"]
				])
			},
			{
				id: "object-position",
				label: "Object position",
				relevance: whenMediaOrBg,
				control: sel([
					["Center", "object-center"],
					["Top", "object-top"],
					["Bottom", "object-bottom"],
					["Left", "object-left"],
					["Right", "object-right"]
				])
			},
			{
				id: "bg-size",
				label: "BG size",
				relevance: whenMediaOrBg,
				control: sel([
					["Auto", "bg-auto"],
					["Cover", "bg-cover"],
					["Contain", "bg-contain"]
				])
			},
			{
				id: "bg-repeat",
				label: "BG repeat",
				relevance: whenMediaOrBg,
				control: sel([
					["Repeat", "bg-repeat"],
					["No repeat", "bg-no-repeat"],
					["Repeat X", "bg-repeat-x"],
					["Repeat Y", "bg-repeat-y"]
				])
			}
		]
	},
	{
		id: "border",
		label: "Border",
		properties: [
			{
				id: "border-color",
				label: "Color",
				control: col("border")
			},
			{
				id: "radius",
				label: "Radius",
				control: slideC([
					["None", "rounded-none"],
					["XS", "rounded-xs"],
					["SM", "rounded-sm"],
					["MD", "rounded-md"],
					["LG", "rounded-lg"],
					["XL", "rounded-xl"],
					["2XL", "rounded-2xl"],
					["3XL", "rounded-3xl"],
					["Full", "rounded-full"]
				], {
					prefix: "rounded",
					format: "length"
				})
			},
			{
				id: "border-style",
				label: "Style",
				control: sel([
					["Solid", "border-solid"],
					["Dashed", "border-dashed"],
					["Dotted", "border-dotted"],
					["Double", "border-double"],
					["None", "border-none"]
				])
			}
		]
	},
	{
		id: "effects",
		label: "Effects",
		properties: [
			{
				id: "opacity",
				label: "Opacity",
				control: slide("opacity", OPACITY),
				default: "opacity-100"
			},
			{
				id: "shadow",
				label: "Shadow",
				control: slideC([
					["None", "shadow-none"],
					["XS", "shadow-xs"],
					["SM", "shadow-sm"],
					["MD", "shadow-md"],
					["LG", "shadow-lg"],
					["XL", "shadow-xl"],
					["2XL", "shadow-2xl"]
				])
			},
			{
				id: "blur",
				label: "Blur",
				control: slideC([
					["None", "blur-none"],
					["XS", "blur-xs"],
					["SM", "blur-sm"],
					["MD", "blur-md"],
					["LG", "blur-lg"],
					["XL", "blur-xl"],
					["2XL", "blur-2xl"],
					["3XL", "blur-3xl"]
				])
			}
		]
	},
	{
		id: "transitions",
		label: "Transitions",
		properties: [
			{
				id: "transition",
				label: "Transition",
				control: sel([
					["None", "transition-none"],
					["All", "transition-all"],
					["Default", "transition"],
					["Colors", "transition-colors"],
					["Opacity", "transition-opacity"],
					["Transform", "transition-transform"],
					["Shadow", "transition-shadow"]
				])
			},
			{
				id: "duration",
				label: "Duration",
				relevance: whenTransition,
				control: slide("duration", [
					"75",
					"100",
					"150",
					"200",
					"300",
					"500",
					"700",
					"1000"
				])
			},
			{
				id: "timing",
				label: "Easing",
				relevance: whenTransition,
				control: ico([
					[
						"Linear",
						"ease-linear",
						"Minus"
					],
					[
						"In",
						"ease-in",
						"Turtle"
					],
					[
						"Out",
						"ease-out",
						"Rabbit"
					],
					[
						"In out",
						"ease-in-out",
						"Spline"
					]
				])
			},
			{
				id: "delay",
				label: "Delay",
				relevance: whenTransition,
				control: slide("delay", [
					"75",
					"150",
					"300",
					"500",
					"700",
					"1000"
				])
			}
		]
	},
	{
		id: "transform",
		label: "Transform",
		properties: [
			{
				id: "scale",
				label: "Scale",
				control: slide("scale", [
					"0",
					"50",
					"75",
					"90",
					"95",
					"100",
					"105",
					"110",
					"125",
					"150"
				])
			},
			{
				id: "transform-origin",
				label: "Origin",
				control: {
					kind: "select",
					options: [
						{
							label: "Center",
							class: "origin-center"
						},
						{
							label: "Top",
							class: "origin-top"
						},
						{
							label: "Top right",
							class: "origin-top-right"
						},
						{
							label: "Right",
							class: "origin-right"
						},
						{
							label: "Bottom right",
							class: "origin-bottom-right"
						},
						{
							label: "Bottom",
							class: "origin-bottom"
						},
						{
							label: "Bottom left",
							class: "origin-bottom-left"
						},
						{
							label: "Left",
							class: "origin-left"
						},
						{
							label: "Top left",
							class: "origin-top-left"
						}
					]
				}
			},
			{
				id: "rotate",
				label: "Rotate",
				control: signed("rotate", [
					"1",
					"2",
					"3",
					"6",
					"12",
					"45",
					"90",
					"180"
				])
			},
			{
				id: "translate-x",
				label: "Translate X",
				control: signed("translate-x", [
					"1",
					"2",
					"3",
					"4",
					"6",
					"8"
				])
			},
			{
				id: "translate-y",
				label: "Translate Y",
				control: signed("translate-y", [
					"1",
					"2",
					"3",
					"4",
					"6",
					"8"
				])
			}
		]
	},
	{
		id: "interactivity",
		label: "Interactivity",
		properties: [
			{
				id: "cursor",
				label: "Cursor",
				control: sel([
					["Auto", "cursor-auto"],
					["Default", "cursor-default"],
					["Pointer", "cursor-pointer"],
					["Wait", "cursor-wait"],
					["Text", "cursor-text"],
					["Move", "cursor-move"],
					["Not allowed", "cursor-not-allowed"]
				])
			},
			{
				id: "user-select",
				label: "User select",
				control: sel([
					["None", "select-none"],
					["Text", "select-text"],
					["All", "select-all"],
					["Auto", "select-auto"]
				])
			},
			{
				id: "pointer-events",
				label: "Pointer events",
				control: ico([[
					"None",
					"pointer-events-none",
					"Ban"
				], [
					"Auto",
					"pointer-events-auto",
					"MousePointer2"
				]])
			}
		]
	}
];
//#endregion
//#region src/lib/styles.ts
function sliderClasses(c) {
	return c.classes ?? c.stops.map((s) => `${c.prefix}-${s}`);
}
function sliderPrefix(c) {
	return c.custom?.prefix ?? c.prefix ?? (c.classes ? derivePrefix(c.classes) : null);
}
var VARIANTS = [
	"hover",
	"focus",
	"focus-visible",
	"focus-within",
	"active",
	"visited",
	"disabled",
	"checked",
	"required",
	"invalid",
	"group-hover",
	"group-focus",
	"peer-hover",
	"peer-focus",
	"peer-checked",
	"first",
	"last",
	"only",
	"odd",
	"even",
	"empty",
	"first-of-type",
	"last-of-type",
	"before",
	"after",
	"marker",
	"selection",
	"placeholder",
	"first-line",
	"first-letter",
	"file",
	"backdrop",
	"sm",
	"md",
	"lg",
	"xl",
	"2xl",
	"dark",
	"print",
	"motion-safe",
	"motion-reduce",
	"rtl",
	"ltr",
	"current",
	"group-current"
];
function buildVocabulary() {
	const out = /* @__PURE__ */ new Set();
	for (const section of STYLE_SECTIONS) for (const prop of section.properties) {
		const control = prop.control;
		if (control.kind === "select") control.options.forEach((o) => out.add(o.class));
		if (control.kind === "icons") control.options.forEach((o) => out.add(o.class));
		if (control.kind === "slider") sliderClasses(control).forEach((c) => out.add(c));
	}
	const spacing = [
		"p",
		"px",
		"py",
		"pt",
		"pb",
		"pl",
		"pr",
		"m",
		"mx",
		"my",
		"mt",
		"mb",
		"ml",
		"mr",
		"gap",
		"gap-x",
		"gap-y"
	];
	const SPACING_VALID = [
		...SPACING,
		"5",
		"14",
		"28",
		"32"
	];
	for (const prefix of spacing) for (const stop of SPACING_VALID) out.add(`${prefix}-${stop}`);
	const SIZE_STOPS = [
		"0",
		"1",
		"2",
		"3",
		"4",
		"5",
		"6",
		"8",
		"10",
		"12",
		"14",
		"16",
		"20",
		"24",
		"28",
		"32",
		"36",
		"40",
		"44",
		"48",
		"52",
		"56",
		"60",
		"64",
		"72",
		"80",
		"96"
	];
	for (const prefix of [
		"w",
		"h",
		"size"
	]) for (const stop of SIZE_STOPS) out.add(`${prefix}-${stop}`);
	for (const prefix of ["translate-x", "translate-y"]) {
		for (const stop of SIZE_STOPS) {
			out.add(`${prefix}-${stop}`);
			if (stop !== "0") out.add(`-${prefix}-${stop}`);
		}
		for (const frac of ["full", "1/2"]) {
			out.add(`${prefix}-${frac}`);
			out.add(`-${prefix}-${frac}`);
		}
	}
	for (const prefix of [
		"top",
		"right",
		"bottom",
		"left",
		"inset",
		"inset-x",
		"inset-y",
		"m",
		"mx",
		"my",
		"mt",
		"mb",
		"ml",
		"mr"
	]) for (const stop of SPACING) if (stop !== "0") out.add(`-${prefix}-${stop}`);
	for (const prefix of [
		"m",
		"mx",
		"my",
		"mt",
		"mb",
		"ml",
		"mr"
	]) out.add(`${prefix}-auto`);
	for (const prefix of [
		"inset",
		"inset-x",
		"inset-y",
		"top",
		"right",
		"bottom",
		"left"
	]) out.add(`${prefix}-auto`);
	for (const prefix of [
		"top",
		"right",
		"bottom",
		"left",
		"inset",
		"inset-x",
		"inset-y"
	]) for (const value of [
		"full",
		"1/2",
		"1/3",
		"2/3",
		"1/4",
		"3/4"
	]) {
		out.add(`${prefix}-${value}`);
		out.add(`-${prefix}-${value}`);
	}
	for (const n of [
		"1",
		"2",
		"3",
		"4",
		"5",
		"6",
		"none"
	]) out.add(`line-clamp-${n}`);
	for (const s of [
		"all",
		"x",
		"y",
		"t",
		"r",
		"b",
		"l"
	]) {
		const prefix = borderWidthScheme.slot("border", s);
		for (const step of borderWidthScheme.steps) out.add(borderWidthScheme.className(prefix, step));
	}
	for (const prefix of [
		"bg",
		"text",
		"border",
		"outline",
		"ring",
		"accent",
		"decoration",
		"divide"
	]) for (const color of Object.keys(TAILWIND_COLORS)) for (const shade of TAILWIND_SHADES) out.add(`${prefix}-${color}-${shade}`);
	for (const axis of ["x", "y"]) {
		out.add(`divide-${axis}`);
		out.add(`divide-${axis}-reverse`);
		for (const w of [
			"0",
			"2",
			"4",
			"8"
		]) out.add(`divide-${axis}-${w}`);
	}
	for (const kw of [
		"solid",
		"dashed",
		"dotted",
		"double",
		"none",
		"white",
		"black",
		"transparent",
		"current"
	]) out.add(`divide-${kw}`);
	for (const w of [
		"0",
		"1",
		"2",
		"4",
		"8"
	]) {
		out.add(`outline-${w}`);
		out.add(`outline-offset-${w}`);
		out.add(`ring-${w}`);
		out.add(`ring-offset-${w}`);
	}
	[
		"outline",
		"outline-hidden",
		"outline-dashed",
		"outline-dotted",
		"outline-double",
		"outline-solid",
		"ring",
		"ring-inset",
		"outline-white",
		"outline-black",
		"outline-transparent",
		"outline-current",
		"ring-white",
		"ring-black",
		"ring-transparent",
		"ring-current",
		"accent-auto",
		"accent-white",
		"accent-black",
		"accent-current",
		"sr-only",
		"not-sr-only"
	].forEach((c) => out.add(c));
	[
		"bg-white",
		"bg-black",
		"bg-transparent",
		"text-white",
		"text-black",
		"border-white",
		"border-black",
		"border-transparent",
		"border-current",
		"text-transparent",
		"text-current",
		"bg-current",
		"relative",
		"absolute",
		"fixed",
		"sticky",
		"flex-wrap",
		"flex-1",
		"shrink-0",
		"grow",
		"w-full",
		"w-auto",
		"w-screen",
		"w-fit",
		"h-full",
		"h-auto",
		"h-screen",
		"h-fit",
		"min-h-screen",
		"max-w-sm",
		"max-w-md",
		"max-w-lg",
		"max-w-xl",
		"max-w-2xl",
		"max-w-4xl",
		"max-w-6xl",
		"mx-auto",
		"italic",
		"underline",
		"uppercase",
		"lowercase",
		"capitalize",
		"truncate",
		"leading-tight",
		"leading-normal",
		"leading-relaxed",
		"tracking-tight",
		"tracking-wide",
		"rounded",
		"shadow",
		"shadow-sm",
		"shadow-md",
		"shadow-lg",
		"shadow-xl",
		"opacity-0",
		"opacity-50",
		"opacity-75",
		"opacity-100",
		"overflow-hidden",
		"overflow-auto",
		"overflow-x-auto",
		"overflow-y-auto",
		"overflow-x-hidden",
		"overflow-y-hidden",
		"overflow-x-scroll",
		"overflow-y-scroll",
		"overflow-clip",
		"overflow-x-clip",
		"overflow-y-clip",
		"transition-all",
		"transition-colors",
		"duration-150",
		"duration-300",
		"duration-500",
		"ease-in",
		"ease-out",
		"ease-in-out",
		"cursor-pointer",
		"select-none",
		"pointer-events-none",
		"z-0",
		"z-10",
		"z-20",
		"z-50",
		"grid-cols-1",
		"grid-cols-2",
		"grid-cols-3",
		"grid-cols-4",
		"grid-cols-6",
		"grid-cols-12",
		"object-cover",
		"object-contain",
		"aspect-square",
		"aspect-video",
		"antialiased",
		"col-span-full",
		"col-auto",
		"row-span-full",
		"inline",
		"inline-block",
		"inline-flex",
		"inline-grid",
		"outline-none",
		"contents",
		"flow-root",
		"whitespace-normal",
		"whitespace-nowrap",
		"whitespace-pre",
		"whitespace-pre-line",
		"whitespace-pre-wrap",
		"break-words",
		"break-all",
		"group",
		"peer",
		"h-px",
		"w-px",
		"inset-0",
		"inset-x-0",
		"inset-y-0",
		"appearance-none",
		"appearance-auto",
		"resize",
		"resize-none",
		"resize-x",
		"resize-y",
		"animate-none",
		"animate-spin",
		"animate-pulse",
		"animate-bounce",
		"animate-ping",
		"table-auto",
		"table-fixed",
		"border-collapse",
		"border-separate",
		"caption-top",
		"caption-bottom",
		"align-top",
		"align-middle",
		"align-bottom",
		"align-baseline",
		"align-text-top",
		"align-text-bottom",
		"align-sub",
		"align-super",
		"prose",
		"visible",
		"invisible",
		"collapse",
		"grayscale",
		"grayscale-0",
		"blur-sm",
		"blur-md",
		"blur-none",
		"backdrop-blur-none",
		"backdrop-blur-sm",
		"backdrop-blur",
		"backdrop-blur-md",
		"backdrop-blur-lg",
		"backdrop-blur-xl",
		"underline-offset-1",
		"underline-offset-2",
		"underline-offset-4",
		"underline-offset-8",
		"place-items-start",
		"place-items-end",
		"place-items-center",
		"place-items-baseline",
		"place-items-stretch",
		"place-content-start",
		"place-content-end",
		"place-content-center",
		"place-content-between",
		"place-content-around",
		"place-content-evenly",
		"place-content-baseline",
		"place-content-stretch",
		"place-self-auto",
		"place-self-start",
		"place-self-end",
		"place-self-center",
		"place-self-stretch",
		"justify-items-start",
		"justify-items-end",
		"justify-items-center",
		"justify-items-stretch",
		"justify-items-normal",
		"justify-self-auto",
		"justify-self-start",
		"justify-self-end",
		"justify-self-center",
		"justify-self-stretch",
		"text-wrap",
		"text-nowrap",
		"text-balance",
		"text-pretty",
		"aspect-auto",
		"isolate",
		"isolation-auto",
		"mix-blend-normal",
		"mix-blend-multiply",
		"mix-blend-screen",
		"mix-blend-overlay",
		"mix-blend-darken",
		"mix-blend-lighten",
		"mix-blend-difference",
		"mix-blend-exclusion",
		"mix-blend-luminosity",
		"mix-blend-plus-lighter",
		"will-change-auto",
		"will-change-scroll",
		"will-change-contents",
		"will-change-transform",
		"scroll-auto",
		"scroll-smooth",
		"snap-none",
		"snap-x",
		"snap-y",
		"snap-both",
		"snap-mandatory",
		"snap-proximity",
		"snap-start",
		"snap-center",
		"snap-end",
		"snap-align-none",
		"snap-normal",
		"snap-always",
		"overscroll-auto",
		"overscroll-contain",
		"overscroll-none",
		"touch-auto",
		"touch-none",
		"touch-pan-x",
		"touch-pan-y",
		"touch-manipulation",
		"touch-pinch-zoom",
		"hyphens-none",
		"hyphens-manual",
		"hyphens-auto",
		"normal-nums",
		"ordinal",
		"slashed-zero",
		"lining-nums",
		"oldstyle-nums",
		"proportional-nums",
		"tabular-nums",
		"bg-linear-to-t",
		"bg-linear-to-tr",
		"bg-linear-to-r",
		"bg-linear-to-br",
		"bg-linear-to-b",
		"bg-linear-to-bl",
		"bg-linear-to-l",
		"bg-linear-to-tl",
		"bg-gradient-to-t",
		"bg-gradient-to-tr",
		"bg-gradient-to-r",
		"bg-gradient-to-br",
		"bg-gradient-to-b",
		"bg-gradient-to-bl",
		"bg-gradient-to-l",
		"bg-gradient-to-tl",
		"bg-radial",
		"bg-conic",
		"bg-none",
		"bg-fixed",
		"bg-local",
		"bg-scroll"
	].forEach((c) => out.add(c));
	for (let n = 1; n <= 12; n++) {
		out.add(`col-span-${n}`);
		out.add(`col-start-${n}`);
		out.add(`col-end-${n}`);
	}
	for (let n = 1; n <= 6; n++) {
		out.add(`row-span-${n}`);
		out.add(`row-start-${n}`);
		out.add(`row-end-${n}`);
	}
	return [...out];
}
var VOCABULARY = buildVocabulary();
var TOKEN_CLASSES = [];
function setStyleTokens(names) {
	propForBaseCache.clear();
	TOKEN_CLASSES = names.flatMap((n) => [
		`bg-${n}`,
		`text-${n}`,
		`border-${n}`,
		`outline-${n}`,
		`ring-${n}`,
		`accent-${n}`,
		`decoration-${n}`,
		`divide-${n}`
	]);
}
function suggestClasses(query, limit = 8) {
	const split = splitClassVariants(query.trim());
	const prefix = split.variants.length ? `${split.variants.join(":")}:` : "";
	const base = split.base.toLowerCase();
	if (!base && !prefix) return [];
	const results = [];
	if (!prefix && base) {
		for (const variant of VARIANTS) if (variant.startsWith(base)) results.push(`${variant}:`);
	}
	const pool = [...TOKEN_CLASSES, ...VOCABULARY];
	const starts = pool.filter((c) => c.startsWith(base)).sort((a, b) => a === base ? -1 : b === base ? 1 : a.length - b.length);
	const contains = base.length > 1 ? pool.filter((c) => !c.startsWith(base) && c.includes(base)) : [];
	for (const cls of [...starts, ...contains]) {
		if (results.length >= limit) break;
		results.push(prefix + cls);
	}
	return results.slice(0, limit);
}
function matchClass(prop, classes) {
	const control = prop.control;
	switch (control.kind) {
		case "select":
		case "icons": return classes.find((cls) => control.options.some((o) => o.class === cls));
		case "color": return classes.find((cls) => {
			if (!cls.startsWith(`${control.prefix}-`)) return false;
			const value = cls.slice(control.prefix.length + 1);
			return value.startsWith("[#") || isPaletteColor(value) || [
				"white",
				"black",
				"transparent"
			].includes(value);
		});
		case "slider": {
			const known = sliderClasses(control);
			const exact = classes.find((cls) => known.includes(cls));
			if (exact) return exact;
			if (control.custom) {
				const { prefix, format } = control.custom;
				return classes.find((cls) => isNamedValueClass(prefix, format, known, cls));
			}
			const prefix = sliderPrefix(control);
			if (prefix) return classes.find((cls) => parseTail(cls, prefix) !== null);
			return;
		}
		case "input": return classes.find((cls) => cls.startsWith(`${control.prefix}-`));
	}
}
var VOCAB_SET = new Set(VOCABULARY);
var VARIANT_SET = new Set(VARIANTS);
var STATE_VARIANTS = /* @__PURE__ */ new Set([
	"hover",
	"focus",
	"focus-visible",
	"active",
	"disabled",
	"group-hover",
	"first",
	"last"
]);
function isStateClass(cls) {
	return splitClassVariants(cls).variants.some((v) => STATE_VARIANTS.has(v));
}
function splitVariant(cls) {
	const { variants, base } = splitClassVariants(cls);
	return {
		variant: variants.length ? `${variants.join(":")}:` : "",
		base
	};
}
var ARBITRARY_VARIANT_RE = /^\[&[^{};]{0,80}\]$/;
var PARAM_VARIANT_RE = /^(?:data|aria|has|not|group-has|peer-has|supports|nth|nth-last)-\[[^{};]{1,80}\]$/;
var GROUP_PEER_RE = /^(?:group|peer)-[a-z][a-z-]*$/;
var NAMED_SCREEN_VARIANT_RE = /^(?:min|max)-(?:sm|md|lg|xl|2xl)$/;
var ACCEPTED_VARIANTS = /* @__PURE__ */ new Set([
	"open",
	"enabled",
	"read-only",
	"read-write",
	"optional",
	"default",
	"indeterminate",
	"placeholder-shown",
	"autofill",
	"in-range",
	"out-of-range",
	"user-valid",
	"user-invalid",
	"inert",
	"target",
	"aria-busy",
	"aria-checked",
	"aria-disabled",
	"aria-expanded",
	"aria-hidden",
	"aria-pressed",
	"aria-readonly",
	"aria-required",
	"aria-selected",
	"first-child",
	"last-child",
	"only-of-type",
	"nth-child",
	"noscript",
	"details-content",
	"starting",
	"first-letter",
	"first-line",
	"placeholder",
	"backdrop",
	"*",
	"**"
]);
function isKnownVariant(v) {
	return VARIANT_SET.has(v) || ACCEPTED_VARIANTS.has(v) || NAMED_SCREEN_VARIANT_RE.test(v) || /^(?:min|max)-\[[0-9.]+(?:px|rem|em)\]$/.test(v) || ARBITRARY_VARIANT_RE.test(v) || PARAM_VARIANT_RE.test(v) || GROUP_PEER_RE.test(v);
}
function splitClassVariants(cls) {
	const variants = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < cls.length; i++) {
		const ch = cls[i];
		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth--;
		else if (ch === ":" && depth === 0) {
			variants.push(cls.slice(start, i));
			start = i + 1;
		}
	}
	return {
		variants,
		base: cls.slice(start)
	};
}
var FLEX_NUMERIC_RE = /^flex-\d+(?:\.\d+)?$/;
var DISPLAY_CLASSES = /* @__PURE__ */ new Set([
	"block",
	"inline-block",
	"inline",
	"flex",
	"inline-flex",
	"grid",
	"inline-grid",
	"hidden",
	"contents",
	"flow-root"
]);
function hasDisplayClass(tokens) {
	return tokens.some((t) => DISPLAY_CLASSES.has(splitVariant(t).base));
}
function backgroundKey(base) {
	if (!base.startsWith("bg-")) return void 0;
	const value = base.slice(3);
	if (value.startsWith("[")) {
		const hint = /^\[([a-z-]+):/.exec(value)?.[1];
		if (hint === "size" || hint === "length") return "background-size";
		if (hint === "position") return "background-position";
		if (hint === "image" || hint === "url") return "background-image";
		if (hint === "color") return "background-color";
		if (/^\[(?:url\(|(?:repeating-)?(?:linear|radial|conic)-gradient\(|image\(|image-set\()/.test(value)) return "background-image";
		return "background-color";
	}
	if (/^(?:auto|cover|contain)$/.test(value) || value.startsWith("size-")) return "background-size";
	if (BG_POSITION_RE.test(base) || value.startsWith("position-")) return "background-position";
	if (/^(?:fixed|local|scroll)$/.test(value)) return "background-attachment";
	if (/^(?:none$|linear-to-|linear$|linear-|radial|conic|gradient-to-)/.test(value)) return "background-image";
	if (/^(?:repeat|no-repeat)/.test(value)) return "background-repeat";
	if (value.startsWith("clip-")) return "background-clip";
	if (value.startsWith("origin-")) return "background-origin";
	if (value.startsWith("blend-")) return "background-blend-mode";
	return "background-color";
}
var FONT_FAMILY_RE = /^font-(?:sans|serif|mono)$/;
var FONT_ARBITRARY_FAMILY_RE = /^font-\[[^\]]*[A-Za-z][^\]]*\]$/;
var SPACING_PREFIX = "(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-w|min-h|max-w|max-h|basis|top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scroll-m[xytblr]?|scroll-p[xytblr]?)";
var SPACING_NUMERIC_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+(?:\\.\\d+)?$`);
var SPACING_FRACTION_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+\\/\\d+$`);
var SIZE_KEYWORD_RE = new RegExp(`^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:${[
	"full",
	"auto",
	"min",
	"max",
	"fit",
	"none",
	"screen",
	"prose",
	"px"
].join("|")})$`);
var SIZE_TSHIRT_RE = /^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)$/;
var DYNAMIC_NUMERIC_RE = /^-?(?:scale|scale-x|scale-y|rotate|skew-x|skew-y|z|opacity|order|grow|shrink|columns|leading)-\d+(?:\.\d+)?$/;
var ROUNDED_RE = /^rounded(?:-(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(?:none|xs|sm|md|lg|xl|[2-4]xl|full))?$/;
var BG_POSITION_RE = /^bg-(?:center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right|left-top|left-bottom|right-top|right-bottom)$/;
var ORIGIN_RE = /^origin-(?:center|top|top-right|right|bottom-right|bottom|bottom-left|left|top-left)$/;
var VISIBILITY_CLASSES = /* @__PURE__ */ new Set([
	"visible",
	"invisible",
	"collapse"
]);
var PANEL_LESS_GROUPS = [
	[/^place-items-/, "place-items"],
	[/^place-content-/, "place-content"],
	[/^place-self-/, "place-self"],
	[/^justify-items-/, "justify-items"],
	[/^justify-self-/, "justify-self"],
	[/^text-(?:wrap|nowrap|balance|pretty)$/, "text-wrap"],
	[/^aspect-/, "aspect-ratio"],
	[/^(?:isolate|isolation-auto)$/, "isolation"],
	[/^mix-blend-/, "mix-blend-mode"],
	[/^will-change-/, "will-change"],
	[/^scroll-(?:auto|smooth)$/, "scroll-behavior"],
	[/^snap-(?:none|x|y|both)$/, "scroll-snap-type"],
	[/^snap-(?:start|center|end|align-none)$/, "scroll-snap-align"],
	[/^overscroll-(?:auto|contain|none)$/, "overscroll-behavior"],
	[/^hyphens-/, "hyphens"]
];
var ARBITRARY_PROPERTY_RE = /^\[([a-z][a-z-]*):[^{};]+\]$/;
var OPACITY_MODIFIER_RE = /^((?:bg|text|border|ring|outline|divide|shadow|from|via|to|decoration|caret|accent|placeholder|fill|stroke)-.+)\/(?:\d{1,3}|\[[^\]]+\])$/;
function isValidClass(cls) {
	const { variants: segments, base } = splitClassVariants(cls);
	if (!base) return false;
	if (segments.some((v) => !isKnownVariant(v))) return false;
	if (/-\[.+\]$/.test(base)) return true;
	if (ARBITRARY_PROPERTY_RE.test(base)) return true;
	const opacity = OPACITY_MODIFIER_RE.exec(base);
	if (opacity) return isValidClass(opacity[1]);
	if (FLEX_NUMERIC_RE.test(base)) return true;
	if (SPACING_NUMERIC_RE.test(base)) return true;
	if (SPACING_FRACTION_RE.test(base)) return true;
	if (SIZE_KEYWORD_RE.test(base)) return true;
	if (SIZE_TSHIRT_RE.test(base)) return true;
	if (DYNAMIC_NUMERIC_RE.test(base)) return true;
	if (ROUNDED_RE.test(base)) return true;
	if (BG_POSITION_RE.test(base)) return true;
	if (ORIGIN_RE.test(base)) return true;
	if (VISIBILITY_CLASSES.has(base)) return true;
	return VOCAB_SET.has(base) || TOKEN_CLASSES.includes(base);
}
var SIZE_FAMILIES = [
	"min-w",
	"min-h",
	"max-w",
	"max-h",
	"basis",
	"size",
	"w",
	"h"
];
function sizeFamily(base) {
	for (const family of SIZE_FAMILIES) if (base.startsWith(`${family}-`) && base.length > family.length + 1) return `size:${family}`;
}
var OFFSET_FAMILIES = [
	"inset-x",
	"inset-y",
	"inset",
	"top",
	"right",
	"bottom",
	"left"
];
var OFFSET_VALUE_RE = /^(?:\d+(?:\.\d+)?|\d+\/\d+|full|auto|px|\[[^\]]+\])$/;
function offsetFamily(base) {
	const bare = base.startsWith("-") ? base.slice(1) : base;
	for (const family of OFFSET_FAMILIES) {
		if (!bare.startsWith(`${family}-`)) continue;
		const value = bare.slice(family.length + 1);
		return OFFSET_VALUE_RE.test(value) ? `offset:${family}` : void 0;
	}
}
var propForBaseCache = /* @__PURE__ */ new Map();
function propForBase(base) {
	if (propForBaseCache.has(base)) return propForBaseCache.get(base);
	let found;
	outer: for (const section of STYLE_SECTIONS) for (const prop of section.properties) if (matchClass(prop, [base]) === base) {
		found = prop;
		break outer;
	}
	propForBaseCache.set(base, found);
	return found;
}
function propKey(base) {
	if (FLEX_NUMERIC_RE.test(base) || [
		"flex-auto",
		"flex-initial",
		"flex-none",
		"flex-1"
	].includes(base)) return "flex-grow-shorthand";
	if (DISPLAY_CLASSES.has(base)) return "display";
	if (VISIBILITY_CLASSES.has(base)) return "visibility";
	const size = sizeFamily(base);
	if (size) return size;
	const offset = offsetFamily(base);
	if (offset) return offset;
	if (base === "truncate" || base.startsWith("line-clamp-")) return "line-clamp";
	for (const [re, prop] of PANEL_LESS_GROUPS) if (re.test(base)) return prop;
	const arbitraryProp = ARBITRARY_PROPERTY_RE.exec(base);
	if (arbitraryProp) return `arbitrary:${arbitraryProp[1]}`;
	const background = backgroundKey(base);
	if (background) return background;
	if (FONT_FAMILY_RE.test(base) || FONT_ARBITRARY_FAMILY_RE.test(base)) return "font-family";
	if (ORIGIN_RE.test(base)) return "transform-origin";
	if (base.startsWith("leading-")) return "line-height";
	const rounded = ROUNDED_RE.exec(base);
	if (rounded) return `border-radius:${rounded[1] ?? "all"}`;
	const dynamic = /^-?([a-z-]+?)-\d+(?:\.\d+)?$/.exec(base);
	if (dynamic && DYNAMIC_NUMERIC_RE.test(base)) return `dynamic:${dynamic[1]}`;
	return propForBase(base);
}
function conflictingToken(cls, tokens) {
	const { variant, base } = splitVariant(cls);
	const key = propKey(base);
	if (!key) return void 0;
	return tokens.find((t) => {
		const s = splitVariant(t);
		return s.variant === variant && s.base !== base && propKey(s.base) === key;
	});
}
function prerequisiteFor(cls, tokens) {
	const { variant, base } = splitVariant(cls);
	const r = propForBase(base)?.relevance;
	if (!r || r.when !== "display") return void 0;
	if (hasDisplayClass(tokens)) return void 0;
	return `${variant}${r.values.includes("flex") ? "flex" : r.values[0]}`;
}
function sameProperty(a, b) {
	if (a === b) return true;
	const ka = propKey(a);
	return ka !== void 0 && ka === propKey(b);
}
var NOT_A_PAINT = {
	text: /^(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[[\d.].*\])$/,
	border: /^(?:\d+|[xytrblse](?:-\d+)?|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing-.*|\[[\d.].*\])$/,
	ring: /^(?:\d+|inset|offset-.*|\[[\d.].*\])$/,
	outline: /^(?:\d+|none|hidden|solid|dashed|dotted|double|offset-.*|\[[\d.].*\])$/,
	decoration: /^(?:\d+|auto|from-font|solid|double|dotted|dashed|wavy|slice|clone)$/,
	divide: /^(?:[xy](?:-\d+|-reverse)?|solid|dashed|dotted|double|none)$/,
	stroke: /^(?:\d+|\[[\d.].*\])$/,
	fill: /^$/,
	accent: /^$/,
	caret: /^$/
};
function paintFamily(base) {
	const dash = base.indexOf("-");
	if (dash === -1) return void 0;
	const prefix = base.slice(0, dash);
	const not = NOT_A_PAINT[prefix];
	if (!not || not.test(base.slice(dash + 1))) return void 0;
	return `${prefix}:paint`;
}
var NAME_TAILS = /* @__PURE__ */ new Set([
	"x",
	"y",
	"t",
	"r",
	"b",
	"l",
	"s",
	"e",
	"inset",
	"reverse"
]);
function headOf(base) {
	const bare = base.startsWith("-") ? base.slice(1) : base;
	if (/^flex-(?:no)?wrap/.test(bare)) return "flex-wrap";
	const bracket = bare.endsWith("]") ? bare.lastIndexOf("-[") : -1;
	const at = bracket !== -1 ? bracket : bare.lastIndexOf("-");
	if (at <= 0) return bare;
	return NAME_TAILS.has(bare.slice(at + 1)) ? bare : bare.slice(0, at);
}
function sameLayerProperty(a, b) {
	if (a === b) return true;
	const pa = paintFamily(a);
	const pb = paintFamily(b);
	if (pa || pb) return pa === pb;
	const ka = propKey(a);
	const kb = propKey(b);
	if (ka !== void 0 && kb !== void 0) return ka === kb;
	return headOf(a) === headOf(b);
}
function mergeClassLayers(base, ...layers) {
	let tokens = base.split(/\s+/).filter(Boolean);
	for (const layer of layers) for (const cls of (layer ?? "").split(/\s+/).filter(Boolean)) {
		const { variant, base: bare } = splitVariant(cls);
		tokens = tokens.filter((t) => {
			const s = splitVariant(t);
			return !(s.variant === variant && sameLayerProperty(s.base, bare));
		});
		tokens.push(cls);
	}
	return tokens.join(" ");
}
var ARBITRARY_CAPABLE = /^(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|w|h|size|min-w|min-h|max-w|max-h|basis|top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scale|scale-[xy]|rotate|z|opacity|leading|tracking|text|bg|border|rounded|blur|duration|delay|grid-cols|grid-rows|col-span|row-span|aspect|shadow|outline|ring)$/;
function unknownClassHint(value) {
	const { variants, base } = splitClassVariants(value);
	const variant = variants.length ? `${variants.join(":")}:` : "";
	const parts = [];
	const badVariants = variants.filter((v) => !isKnownVariant(v));
	if (badVariants.length) return ` — ${badVariants.map((v) => `"${v}:"`).join(", ")} ${badVariants.length === 1 ? "is not a" : "are not"} known variant${badVariants.length === 1 ? "" : "s"}. Responsive: a named screen ("md:", "max-md:") or an arbitrary width ("max-[767px]:"). State: "hover:", "focus-visible:", "group-hover:", "data-[open]:". Descendants: "[&>li]:".`;
	const tokenish = /^(?:bg|text|border|outline|ring|accent|decoration|divide)-([a-z][a-z0-9-]*)$/.exec(base);
	if (tokenish && !TOKEN_CLASSES.includes(base)) parts.push(`if "${tokenish[1]}" is meant to be a design token, no token with that name exists yet — save it in the project settings first`);
	const dash = base.lastIndexOf("-");
	const prefix = dash > 0 ? base.slice(0, dash) : "";
	if (prefix && ARBITRARY_CAPABLE.test(prefix)) parts.push(`for an off-scale value use the arbitrary form "${variant}${prefix}-[…]"`);
	const near = suggestClasses(base, 3).filter((c) => c !== base && !c.endsWith(":"));
	if (near.length) parts.push(`did you mean ${near.map((c) => `"${variant}${c}"`).join(", ")}?`);
	return parts.length ? ` — ${parts.join("; ")}` : "";
}
function applyClass(cls, tokens, opts = {}) {
	const value = cls.trim();
	if (!value) return { error: "" };
	if (!isValidClass(value)) return { error: `"${value}" is not a known class${unknownClassHint(value)}` };
	if (tokens.includes(value)) return { error: `${value} is already added` };
	let next = [...tokens];
	const conflict = conflictingToken(value, next);
	if (conflict) next = next.filter((t) => t !== conflict);
	next.push(value);
	if (opts.prerequisites !== false) {
		const prereq = prerequisiteFor(value, next);
		if (prereq && !next.includes(prereq)) next.unshift(prereq);
	}
	return { tokens: next };
}
//#endregion
//#region src/lib/variants.ts
var variantKey = (axis, option) => `${axis}:${option}`;
var VARIANT_NAME_RE = /^[a-z][a-z0-9-]*$/;
function pickedKeys(def, picks) {
	return (def?.variants ?? []).map((axis) => variantKey(axis.name, axis.options.includes(picks[axis.name] ?? "") ? picks[axis.name] : axis.default));
}
function effectiveClasses(node, def, picks) {
	const base = node.classes ?? "";
	const overrides = node.variantClasses;
	if (!overrides || !def?.variants?.length) return base;
	return mergeClassLayers(base, ...pickedKeys(def, picks).map((key) => overrides[key]));
}
//#endregion
//#region src/lib/componentOps.ts
function setComponentMeta(def, meta) {
	delete def.category;
	delete def.variants;
	const category = meta.category?.trim();
	if (category) def.category = category;
	if (meta.variants?.length) def.variants = meta.variants.map((axis) => ({
		name: axis.name,
		options: [...axis.options],
		default: axis.default
	}));
}
function componentUsage(project, name) {
	let count = 0;
	const pages = [];
	for (const page of project.pages) {
		let onPage = 0;
		walkNodes(page.elements, (n) => {
			if (n.type === name) onPage++;
		});
		if (!onPage) continue;
		count += onPage;
		pages.push({
			id: page.id,
			name: page.name
		});
	}
	const hosts = project.components.filter((c) => c.name !== name && nestedComponentNames$1(c).includes(name)).map((c) => c.name);
	return {
		count,
		pages,
		hosts
	};
}
function renameComponent(project, id, rawName) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return null;
	const name = normalizeComponentName(rawName, project.components.filter((c) => c.id !== id).map((c) => c.name));
	if (name === def.name) return name;
	const old = def.name;
	def.name = name;
	def.root.type = name;
	for (const host of project.components) walkNodes(host.root.children, (node) => {
		if (node.type === old) node.type = name;
	});
	for (const page of project.pages) walkNodes(page.elements, (node) => {
		if (node.type === old) node.type = name;
	});
	return name;
}
function duplicateComponent(project, id) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return null;
	const name = normalizeComponentName(`${def.name}Copy`, project.components.map((c) => c.name));
	const { cloned } = cloneForMaster(def.root);
	cloned.type = name;
	const copy = {
		id: uid(),
		name,
		root: cloned
	};
	setComponentMeta(copy, {
		category: def.category,
		variants: def.variants
	});
	project.components.push(copy);
	return copy;
}
function setComponentCategory(project, id, category) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return false;
	setComponentMeta(def, {
		category,
		variants: def.variants
	});
	return true;
}
var MIRROR_KEYS = [
	"content",
	"src",
	"svg",
	"background",
	"locales",
	"hidden",
	"variants",
	"link"
];
function inheritFromMirrors(node, mirrors) {
	for (const key of MIRROR_KEYS) {
		if (node[key] !== void 0 && node[key] !== "") continue;
		const from = mirrors.find((m) => m[key] !== void 0 && m[key] !== "");
		if (from) node[key] = deepClone(from[key]);
	}
}
function pairWithMaster(instance, def, components) {
	const pairs = [];
	const masterToInstance = /* @__PURE__ */ new Map();
	const map = buildInstanceMap$1([instance], [def, ...components.filter((c) => c !== def)]);
	walkNodes([instance], (node) => {
		const mapping = map.get(node.id);
		if (!mapping) return;
		if (mapping.def !== def) {
			inheritFromMirrors(node, mapping.mirrors);
			return;
		}
		pairs.push({
			node,
			master: mapping.master,
			classes: effectiveClasses(mapping.master, mapping.def, mapping.picks)
		});
		masterToInstance.set(mapping.master.id, node.id);
	});
	return {
		pairs,
		masterToInstance
	};
}
function bakeMasterState(pairs, masterToInstance) {
	const retarget = (targetId) => targetId ? masterToInstance.get(targetId) ?? targetId : null;
	for (const { node, master, classes } of pairs) {
		if (classes) node.classes = classes;
		delete node.variants;
		delete node.slot;
		if (master.attributes) node.attributes = deepClone(master.attributes);
		if (master.interactions?.length) node.interactions = master.interactions.map((b) => ({
			...deepClone(b),
			id: uid(),
			targetId: retarget(b.targetId)
		}));
		if (master.animations?.length) node.animations = master.animations.map((b) => ({
			...deepClone(b),
			id: uid(),
			targetId: retarget(b.targetId)
		}));
		if (!node.content && master.content) node.content = master.content;
		if (!node.src && master.src) node.src = master.src;
		if (!node.svg && master.svg) node.svg = master.svg;
		if (node.hidden === void 0 && master.hidden) node.hidden = true;
		else if (node.hidden === false) delete node.hidden;
		if (!node.background && master.background) node.background = master.background;
		if (!node.locales && master.locales) node.locales = deepClone(master.locales);
		if (node.link === void 0 && master.link !== void 0) node.link = master.link;
		if (!node.listQuery && master.listQuery) node.listQuery = deepClone(master.listQuery);
		if (!node.slider && master.slider) node.slider = deepClone(master.slider);
		if (!node.form && master.form) node.form = deepClone(master.form);
		if (!node.entryId && master.entryId) node.entryId = master.entryId;
		if (!node.fieldAttrs && master.fieldAttrs) node.fieldAttrs = deepClone(master.fieldAttrs);
		if (node.instanceAttributes) {
			node.attributes = mergeAttributeLayers(node.attributes, node.instanceAttributes);
			delete node.instanceAttributes;
		}
	}
}
function isBareWrapper(root) {
	return !root.classes?.trim() && !root.background && !root.interactions?.length;
}
function detachOne(page, def, instanceId, components) {
	const instance = findNode(page.elements, instanceId);
	if (!instance || instance.type !== def.name) return false;
	const parent = findParent(page.elements, instanceId);
	if (!parent) return false;
	if (!instance.children.length && def.root.children.length) alignStructure(instance, def.root);
	const { pairs, masterToInstance } = pairWithMaster(instance, def, components);
	bakeMasterState(pairs, masterToInstance);
	if (!isBareWrapper(def.root)) {
		instance.type = "div";
		return true;
	}
	const at = parent.children.indexOf(instance);
	const first = instance.children[0];
	if (first) {
		if (instance.ref && !first.ref) first.ref = instance.ref;
		if (instance.htmlId && !first.htmlId) first.htmlId = instance.htmlId;
	}
	parent.children.splice(at, 1, ...instance.children);
	return true;
}
function detachComponentInstances(project, def) {
	let detached = 0;
	for (const page of project.pages) {
		const ids = [];
		walkNodes(page.elements, (n) => {
			if (n.type === def.name) ids.push(n.id);
		});
		if (!ids.length) continue;
		for (const id of ids) if (detachOne(page, def, id, project.components)) detached++;
	}
	return detached;
}
function detachInstance(project, page, instanceId) {
	const node = findNode(page.elements, instanceId);
	const def = node ? project.components.find((c) => c.name === node.type) : null;
	if (!def) return false;
	if (!detachOne(page, def, instanceId, project.components)) return false;
	return true;
}
function pushMasterStructure(project, def, report) {
	if (!project.components.some((c) => c.id === def.id)) return 0;
	const chain = effectiveLinkChain(project.components);
	alignMirrors(project.components, chain);
	let moved = 0;
	for (const page of project.pages) {
		const instances = [];
		walkNodes(page.elements, (n) => {
			if (n.type === def.name) instances.push(n);
		});
		if (!instances.length) continue;
		for (const node of instances) {
			const lost = report ? [] : void 0;
			if (alignStructure(node, def.root, chain, report ? lost : void 0)) moved++;
			if (report) for (const entry of lost) report.lost.push({
				pageId: page.id,
				page: page.name,
				...node.ref ? { ref: node.ref } : {},
				...entry
			});
		}
	}
	return moved;
}
function alignMirrors(components, chain) {
	for (const host of dependencyOrder$1(components)) alignHostMirrors(host, components, chain);
}
function deleteComponent(project, id) {
	const def = project.components.find((c) => c.id === id);
	if (!def) return false;
	for (const host of dependencyOrder$1(project.components)) {
		if (host === def) continue;
		const held = nestedWrappers(host, def.name);
		if (!held.length) continue;
		for (const wrapper of held) detachInMaster(host, wrapper, def);
		pushMasterStructure(project, host);
	}
	detachComponentInstances(project, def);
	project.components = project.components.filter((c) => c.id !== id);
	return true;
}
function detachInMaster(host, wrapper, inner) {
	const parent = findParent([host.root], wrapper.id);
	if (!parent) return;
	const picks = resolvePicks(inner, wrapper, []);
	const { cloned } = cloneForMaster(inner.root);
	const bake = (node, master, mirror, held) => {
		if (!held) {
			const classes = effectiveClasses(master, inner, picks);
			if (classes) node.classes = classes;
			else delete node.classes;
			delete node.variantClasses;
		}
		if (mirror) inheritFromMirrors(clearForOverlay(node, mirror), [mirror]);
		if (node.hidden === false) delete node.hidden;
		node.children.forEach((child, i) => {
			const below = master.children[i];
			if (!below) return;
			bake(child, below, mirror?.children[i], held || isComponentType(child.type));
		});
	};
	bake(cloned, inner.root, wrapper, false);
	delete cloned.variants;
	const bare = !cloned.classes?.trim() && !cloned.background && !cloned.interactions?.length;
	const at = parent.children.indexOf(wrapper);
	if (bare) parent.children.splice(at, 1, ...cloned.children);
	else parent.children.splice(at, 1, {
		...cloned,
		type: "div"
	});
}
function clearForOverlay(node, mirror) {
	for (const key of MIRROR_KEYS) if (mirror[key] !== void 0 && mirror[key] !== "") delete node[key];
	return node;
}
//#endregion
//#region src/lib/shared/urls.js
var SAFE_HREF = /^(\/|#|https?:|mailto:|tel:)/i;
var SAFE_SRC = /^(\/|#|https?:|mailto:|tel:|data:image\/|data:video\/)/i;
//#endregion
//#region src/lib/shared/richtext.js
var ALLOWED = {
	b: {},
	strong: {},
	i: {},
	em: {},
	u: {},
	mark: {},
	code: {},
	sup: {},
	sub: {},
	br: { void: true },
	hr: { void: true },
	p: {},
	h2: {},
	h3: {},
	h4: {},
	blockquote: {},
	ul: {},
	ol: {},
	li: {},
	a: { href: true }
};
var escapeText$2 = (s) => s.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
var escapeAttr$1 = (s) => s.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
function isRich(value) {
	return typeof value === "string" && /<\/?(b|strong|i|em|u|mark|code|sup|sub|a|ul|ol|li|br|hr|p|h2|h3|h4|blockquote)[\s>/]/i.test(value);
}
function sanitizeRich(html) {
	if (typeof html !== "string" || !html) return "";
	const out = [];
	const open = [];
	for (const token of html.match(/<[^>]*>|[^<]+|</g) ?? []) {
		if (token[0] !== "<" || token.length === 1) {
			out.push(escapeText$2(token));
			continue;
		}
		const match = token.match(/^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/);
		if (!match) {
			out.push(escapeText$2(token));
			continue;
		}
		const closing = match[1] === "/";
		const tag = match[2].toLowerCase();
		const spec = ALLOWED[tag];
		if (!spec) continue;
		if (spec.void) {
			if (!closing) out.push(`<${tag}>`);
			continue;
		}
		if (closing) {
			const at = open.lastIndexOf(tag);
			if (at === -1) continue;
			for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`);
			open.length = at;
			continue;
		}
		if (tag === "a") {
			const href = match[3].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
			const raw = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
			const safe = SAFE_HREF.test(raw) ? raw : "";
			out.push(safe ? `<a href="${escapeAttr$1(safe)}" rel="noopener">` : "<a>");
		} else out.push(`<${tag}>`);
		open.push(tag);
	}
	for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);
	return out.join("");
}
//#endregion
//#region src/lib/html/ids.ts
var BASE = 8;
function shortIds(roots) {
	const ids = [];
	walkNodes(roots, (n) => ids.push(n.id));
	const out = /* @__PURE__ */ new Map();
	const taken = /* @__PURE__ */ new Set();
	for (const id of ids) {
		const flat = id.replace(/-/g, "");
		let length = Math.min(BASE, flat.length);
		let short = flat.slice(0, length);
		while (taken.has(short) && length < flat.length) short = flat.slice(0, ++length);
		if (taken.has(short)) continue;
		taken.add(short);
		out.set(id, short);
	}
	return out;
}
function nodesByShortId(roots) {
	const out = /* @__PURE__ */ new Map();
	const shorts = shortIds(roots);
	walkNodes(roots, (n) => {
		const short = shorts.get(n.id);
		if (short) out.set(short, n);
		out.set(n.id, n);
		out.set(n.id.replace(/-/g, ""), n);
	});
	return out;
}
//#endregion
//#region src/lib/html/serialize.ts
var INDENT = "  ";
var escapeText$1 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var ELIDED_DATA_URL = "data:…(elided)";
var showSrc = (src) => src.startsWith("data:") ? ELIDED_DATA_URL : src;
function attrsFor(node, ctx, inInstance) {
	const mapping = ctx.map.get(node.id);
	const shared = inInstance || !!mapping && isInstanceWrapper$1(mapping);
	const out = [];
	const short = ctx.shorts.get(node.id);
	if (ctx.ids && short) out.push(["data-id", short]);
	if (node.ref) out.push(["data-ref", node.ref]);
	if (!shared && ctx.mode === "full" && node.classes?.trim()) out.push(["class", node.classes.trim()]);
	const rest = [];
	for (const [name, value] of Object.entries(impliedAttrs(node.type))) rest.push([name, value]);
	if (node.htmlId) rest.push(["id", node.htmlId]);
	if (node.arg) rest.push([SOURCE_TYPES.has(node.type) ? "source" : "data-field", node.arg]);
	if (node.link) rest.push(["href", node.link]);
	if (node.src) rest.push(["src", showSrc(node.src)]);
	if (node.type === "icon") rest.push(["data-icon", iconName(node)]);
	if (node.type === "text") rest.push(["data-type", "text"]);
	if (node.hidden !== void 0) rest.push(["data-hidden", String(node.hidden)]);
	if (node.channel) rest.push(["data-channel", node.channel]);
	if (node.slot) rest.push(["data-slot", true]);
	const implied = impliedAttrs(node.type);
	for (const [name, value] of Object.entries(node.attributes ?? {})) if (!shared && implied[name] === void 0) rest.push([name, value]);
	for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) rest.push([`data-bind-${attr}`, field]);
	for (const [axis, option] of Object.entries(node.variants ?? {})) rest.push([`data-variant-${axis}`, option]);
	if (ctx.mode === "full" && ctx.effects) {
		const effects = ctx.effectNames(node);
		if (effects.interactions.length) rest.push(["data-interactions", effects.interactions.join(", ")]);
		if (effects.animations.length) rest.push(["data-animations", effects.animations.join(", ")]);
	}
	rest.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
	return [...out, ...rest].map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`);
}
var iconName = (node) => node.svg?.match(/data-icon="([a-z0-9:_-]+)"/)?.[1] ?? (node.svg ? "custom" : "");
function emit(node, depth, ctx, inInstance, out) {
	const pad = INDENT.repeat(depth);
	const tag = tagForType(node.type);
	const attrs = attrsFor(node, ctx, inInstance).join("");
	const isInstance = isComponentType(node.type) && node.id !== ctx.masterRootId;
	if (isLeafType(node.type)) {
		const text = ctx.mode === "full" ? node.content ?? "" : "";
		if (!text) {
			out.push(`${pad}<${tag}${attrs} />`);
			return;
		}
		const raw = isRich(text) && node.type !== "custom-code";
		out.push(`${pad}<${tag}${attrs}>${raw ? text : escapeText$1(text)}</${tag}>`);
		return;
	}
	if (!node.children.length) {
		out.push(`${pad}<${tag}${attrs} />`);
		return;
	}
	out.push(`${pad}<${tag}${attrs}>`);
	for (const child of node.children) emit(child, depth + 1, ctx, (inInstance || isInstance) && !node.slot, out);
	out.push(`${pad}</${tag}>`);
}
function contextFor(project, roots, mapRoots, opts) {
	const components = project.components ?? [];
	const byId = /* @__PURE__ */ new Map();
	for (const effect of project.interactions ?? []) byId.set(effect.id, effect.name);
	for (const anim of project.animations ?? []) byId.set(anim.id, anim.name);
	const map = buildInstanceMap$1(mapRoots, components);
	return {
		mode: opts.mode ?? "full",
		ids: opts.ids !== false,
		effects: opts.effects !== false,
		shorts: shortIds(roots),
		map,
		components,
		effectNames: (node) => {
			const mapping = map.get(node.id);
			const owner = mapping && !isInstanceWrapper$1(mapping) ? mapping.master : node;
			return {
				interactions: (owner.interactions ?? []).map((b) => byId.get(b.interactionId) ?? "?"),
				animations: (owner.animations ?? []).map((b) => byId.get(b.animationId) ?? "?")
			};
		}
	};
}
function pageToHtml(page, project, opts = {}) {
	const body = page.elements.find((n) => n.type === "body");
	if (!body) return "<body />";
	const ctx = contextFor(project, page.elements, page.elements, opts);
	const root = opts.subtree ? resolveSubtree(page.elements, opts.subtree, ctx) : body;
	if (!root) return "";
	const out = [];
	const mapping = ctx.map.get(root.id);
	emit(root, 0, ctx, !!mapping && !isInstanceWrapper$1(mapping), out);
	return out.join("\n");
}
function masterToHtml(def, project, opts = {}) {
	const ctx = {
		...contextFor(project, [def.root], def.root.children, opts),
		masterRootId: def.root.id
	};
	const out = [];
	emit(def.root, 0, ctx, false, out);
	return out.join("\n");
}
function resolveSubtree(roots, key, ctx) {
	for (const [id, short] of ctx.shorts) if (short === key) return findNode(roots, id);
	const byId = findNode(roots, key);
	if (byId) return byId;
	let byRef = null;
	const visit = (nodes) => {
		for (const node of nodes) {
			if (byRef) return;
			if (node.ref === key) byRef = node;
			else visit(node.children);
		}
	};
	visit(roots);
	return byRef;
}
//#endregion
//#region src/lib/html/parse.ts
var MAX_INPUT = 2e6;
var MAX_DEPTH = 64;
var MAX_ERRORS = 20;
var TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*/;
var ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*/;
function parseHtml(input, components = []) {
	const errors = [];
	const notes = [];
	const roots = [];
	if (input.length > 2e6) return {
		roots,
		errors: [{
			message: `input is ${input.length} bytes; the limit is ${MAX_INPUT}. Write one subtree at a time (edit_structure) rather than the whole page.`,
			line: 1,
			col: 1
		}],
		notes
	};
	const lineStarts = [0];
	for (let k = 0; k < input.length; k++) if (input[k] === "\n") lineStarts.push(k + 1);
	const at = (offset) => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = lo + hi + 1 >> 1;
			if (lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return {
			line: lo + 1,
			col: offset - lineStarts[lo] + 1
		};
	};
	const fail = (offset, message) => {
		if (errors.length >= MAX_ERRORS) return;
		errors.push({
			message,
			...at(offset)
		});
	};
	const stack = [];
	const unknownOpen = /* @__PURE__ */ new Map();
	const push = (node) => {
		const parent = stack[stack.length - 1];
		if (parent) parent.children.push(node);
		else roots.push(node);
	};
	let i = 0;
	while (i < input.length && errors.length < MAX_ERRORS) {
		const lt = input.indexOf("<", i);
		if (lt === -1) {
			reportStrayText(input.slice(i), i);
			break;
		}
		if (lt > i) reportStrayText(input.slice(i, lt), i);
		i = lt;
		if (input.startsWith("<!--", i)) {
			const end = input.indexOf("-->", i + 4);
			if (end === -1) return bail(i, "unterminated comment");
			i = end + 3;
			continue;
		}
		if (input.startsWith("<!", i)) {
			const end = input.indexOf(">", i);
			if (end === -1) return bail(i, "unterminated declaration");
			i = end + 1;
			continue;
		}
		if (input[i + 1] === "/") {
			const match = TAG_NAME.exec(input.slice(i + 2));
			const end = input.indexOf(">", i);
			if (!match || end === -1) return bail(i, "malformed closing tag");
			const tag = match[0];
			const skipping = unknownOpen.get(tag);
			if (skipping) {
				if (skipping === 1) unknownOpen.delete(tag);
				else unknownOpen.set(tag, skipping - 1);
				i = end + 1;
				continue;
			}
			const open = stack[stack.length - 1];
			if (!open) {
				fail(i, `</${tag}> closes nothing`);
				i = end + 1;
				continue;
			}
			if (open.tag !== tag) return bail(i, `</${tag}> does not close <${open.tag}>, opened on line ${open.line}`);
			stack.pop();
			i = end + 1;
			continue;
		}
		const start = i;
		const nameMatch = TAG_NAME.exec(input.slice(i + 1));
		if (!nameMatch) return bail(i, "'<' does not start a tag — write a literal one as &lt;");
		const tag = nameMatch[0];
		i += 1 + tag.length;
		const head = readAttrs(tag, start);
		if (!head) return {
			roots,
			errors,
			notes
		};
		const { attrs, selfClosed } = head;
		i = head.after;
		const refuseTag = (message) => {
			fail(start, message);
			if (!selfClosed && !isLenientVoidTag(tag)) unknownOpen.set(tag, (unknownOpen.get(tag) ?? 0) + 1);
		};
		if (FORBIDDEN_TAGS.has(tag.toLowerCase())) {
			refuseTag(`<${tag}> is never allowed; script and style belong in the project's custom code`);
			continue;
		}
		const resolved = typeForTag(tag, attrs, components);
		if (!resolved || !isRenderableType(resolved.type)) {
			refuseTag(`unknown element <${tag}>`);
			continue;
		}
		if (resolved.note && !notes.includes(resolved.note)) notes.push(resolved.note);
		const node = {
			type: resolved.type,
			tag,
			attrs,
			children: [],
			...at(start)
		};
		if (stack.length >= 64) return bail(start, `nesting deeper than 64 elements`);
		push(node);
		if (selfClosed || isLenientVoidTag(tag)) continue;
		if (node.type === "div") {
			const nextTag = input.indexOf("<", i);
			if ((nextTag === -1 ? input.slice(i) : input.slice(i, nextTag)).trim() && input.startsWith(`</${tag}`, nextTag)) node.type = "text";
		}
		if (isLeafType(node.type)) {
			const end = input.indexOf(`</${tag}`, i);
			if (end === -1) return bail(start, `<${tag}> is never closed`);
			node.text = input.slice(i, end);
			const gt = input.indexOf(">", end);
			i = gt === -1 ? input.length : gt + 1;
			continue;
		}
		stack.push(node);
	}
	for (const open of stack) {
		if (errors.length >= MAX_ERRORS) break;
		errors.push({
			message: `<${open.tag}> is never closed`,
			line: open.line,
			col: open.col
		});
	}
	return {
		roots,
		errors,
		notes
	};
	function bail(offset, message) {
		fail(offset, message);
		return {
			roots,
			errors,
			notes
		};
	}
	function reportStrayText(text, offset) {
		if (!text.trim()) return;
		const parent = stack[stack.length - 1];
		const quoted = text.trim().slice(0, 40);
		fail(offset + (text.length - text.trimStart().length), parent ? `"${quoted}" sits directly inside <${parent.tag}>, which is a container. Put text in a text element: <p>, <span>, <h2>, or <div data-type="text">.` : `"${quoted}" is outside any element`);
	}
	function readAttrs(tag, tagStart) {
		const attrs = {};
		let k = i;
		for (;;) {
			while (k < input.length && /\s/.test(input[k])) k++;
			if (k >= input.length) {
				fail(tagStart, `<${tag}> is not closed with '>'`);
				return null;
			}
			if (input[k] === ">") return {
				attrs,
				selfClosed: false,
				after: k + 1
			};
			if (input[k] === "/" && input[k + 1] === ">") return {
				attrs,
				selfClosed: true,
				after: k + 2
			};
			const nameMatch = ATTR_NAME.exec(input.slice(k));
			if (!nameMatch) {
				fail(k, `<${tag}>: '${input[k]}' does not start an attribute name`);
				return null;
			}
			const name = nameMatch[0].toLowerCase();
			const nameAt = k;
			k += nameMatch[0].length;
			if (name.startsWith("on")) {
				fail(nameAt, `<${tag}>: '${name}' event handlers are never allowed`);
				return null;
			}
			if (name in attrs) {
				fail(nameAt, `<${tag}>: '${name}' is written twice`);
				return null;
			}
			while (k < input.length && /\s/.test(input[k])) k++;
			if (input[k] !== "=") {
				attrs[name] = "";
				continue;
			}
			k++;
			while (k < input.length && /\s/.test(input[k])) k++;
			const quote = input[k];
			if (quote !== "\"" && quote !== "'") {
				fail(k, `<${tag}>: the value of '${name}' must be quoted`);
				return null;
			}
			const end = input.indexOf(quote, k + 1);
			if (end === -1) {
				fail(k, `<${tag}>: the value of '${name}' is not closed`);
				return null;
			}
			attrs[name] = decodeEntities(input.slice(k + 1, end));
			k = end + 1;
		}
	}
}
function decodeEntities(text) {
	return text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
//#endregion
//#region src/lib/shared/interactionKeys.js
/**
* The key interaction STATE is held under: one boolean per (interaction, target)
* within a scope, so any number of triggers drive the same effect.
* @param {string} interactionId
* @param {string} targetId the node the classes land on (never null — callers
*   resolve `binding.targetId ?? ownerId` first)
* @param {string} [scope] component instance + collection-list repeat isolation
* @returns {string}
*/
function interactionStateKey(interactionId, targetId, scope) {
	const base = `${interactionId}:${targetId}`;
	return scope ? `${base}@${scope}` : base;
}
/**
* The key an exclusive GROUP is tracked under. Deliberately scoped to the
* component INSTANCE only and never to the collection-list repeat: "one
* accordion open at a time" has to hold ACROSS the repeats of one list (that is
* the whole point), while two instances of the same component stay independent.
* @param {string} group author-chosen group name
* @param {string} [instanceScope] the component instance part of the scope only
* @returns {string}
*/
function interactionGroupKey(group, instanceScope) {
	return instanceScope ? `${group}@${instanceScope}` : group;
}
var CHANNEL_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
var RESERVED_CHANNEL_NAMES = /* @__PURE__ */ new Set(["item", "locale"]);
/**
* Is this `targetId` a channel rather than a node id?
* @param {string|null|undefined} targetId
* @returns {boolean}
*/
function isChannelTarget(targetId) {
	if (typeof targetId !== "string" || targetId[0] !== "@") return false;
	const name = targetId.slice(1);
	return CHANNEL_NAME_RE.test(name) && !RESERVED_CHANNEL_NAMES.has(name);
}
function channelName(targetId) {
	return isChannelTarget(targetId) ? targetId.slice(1) : null;
}
function channelTargetId(name) {
	return `@${name}`;
}
function isChannelName(name) {
	return typeof name === "string" && CHANNEL_NAME_RE.test(name) && !RESERVED_CHANNEL_NAMES.has(name);
}
var INTERACTION_ACTIONS = [
	"toggle",
	"on",
	"off"
];
var INTERACTION_TRIGGERS = [
	"hover",
	"click",
	"appear",
	"scrolled",
	"change",
	"load"
];
var INTERACTION_CLOSE_ON = ["outside", "escape"];
var INTERACTION_ONCE = ["session", "local"];
var DEFAULT_SCROLL_AT = 50;
var SYMMETRIC_TRIGGERS = /* @__PURE__ */ new Set([
	"hover",
	"scrolled",
	"change",
	"load"
]);
function isSymmetricTrigger(trigger) {
	return SYMMETRIC_TRIGGERS.has(trigger);
}
//#endregion
//#region src/lib/shared/fields.js
function refIds(entry, fieldName) {
	const v = entry?.values?.[fieldName];
	if (Array.isArray(v)) return v;
	return typeof v === "string" && v ? [v] : [];
}
function resolveBinding(collections, collection, entry, path) {
	if (!collection || !path) return null;
	const dot = path.indexOf(".");
	const head = dot === -1 ? path : path.slice(0, dot);
	const tail = dot === -1 ? null : path.slice(dot + 1);
	const field = collection.fields.find((f) => f.name === head);
	if (!field) return null;
	if (tail === null) return {
		collection,
		field,
		entry: entry ?? null
	};
	if (field.type !== "reference" || tail.includes(".")) return null;
	const refCollection = collections.find((c) => c.id === field.refCollectionId) ?? null;
	const refField = refCollection?.fields.find((f) => f.name === tail) ?? null;
	if (!refCollection || !refField) return null;
	const id = entry?.values?.[head];
	return {
		collection: refCollection,
		field: refField,
		entry: typeof id === "string" && refCollection.entries.find((e) => e.id === id) || null
	};
}
function mediaUrls(entry, fieldName) {
	const v = entry?.values?.[fieldName];
	if (Array.isArray(v)) return v.filter((u) => typeof u === "string" && u);
	return typeof v === "string" && v ? [v] : [];
}
function mediaListScope(field, scopeEntry) {
	const urls = mediaUrls(scopeEntry, field.name);
	return {
		collection: {
			id: `media:${field.id ?? field.name}`,
			name: field.name,
			synthetic: true,
			fields: [{
				id: `${field.id ?? field.name}:src`,
				name: field.name,
				type: "image"
			}],
			entries: []
		},
		entries: urls.map((url, i) => ({
			id: `${field.name}:${i}`,
			name: "",
			slug: "",
			values: { [field.name]: url }
		}))
	};
}
/**
* The site's own published pages, as a synthetic collection.
*
* `:collection-list[@pages]` repeats over them, so an auto nav / footer menu is
* DATA rather than a hand-maintained list of links — which is also what makes
* "every page except the one you're on" expressible (`excludeCurrent`, since the
* synthetic entry ids ARE page ids) and what lets `@item` link each row to its
* page. The `@` prefix is reserved by the lexer, so this can never collide with
* a collection someone actually named "pages".
*
* Fields: `title` (the page name), `path`, `slug` (the last path segment).
* @param {{id: string, name: string, path: string, status?: string, collectionId?: string}[]} pages
*/
function pagesListScope(pages) {
	const entries = (pages ?? []).filter((p) => p.status === "published" && !p.collectionId).map((page) => {
		const path = page.path || "/";
		const slug = path.split("/").filter(Boolean).pop() ?? "";
		return {
			id: page.id,
			name: page.name,
			slug,
			routePath: path,
			values: {
				title: page.name,
				path,
				slug
			},
			createdAt: 0
		};
	});
	return {
		collection: {
			id: "@pages",
			name: "@pages",
			fields: [
				{
					id: "@title",
					name: "title",
					type: "text"
				},
				{
					id: "@path",
					name: "path",
					type: "text"
				},
				{
					id: "@slug",
					name: "slug",
					type: "text"
				}
			],
			entries
		},
		entries
	};
}
function resolveListScope(collections, scopeCollection, scopeEntry, arg, pages) {
	if (!arg) return null;
	if (arg === "@pages") return pagesListScope(pages);
	const named = collections.find((c) => c.name === arg);
	if (named) return {
		collection: named,
		entries: named.entries
	};
	const field = scopeCollection?.fields.find((f) => f.name === arg);
	if (!field) return null;
	if (field.type === "multi-image") return mediaListScope(field, scopeEntry);
	if (field.type !== "multi-reference") return null;
	const target = collections.find((c) => c.id === field.refCollectionId);
	if (!target) return null;
	return {
		collection: target,
		entries: refIds(scopeEntry, arg).map((id) => target.entries.find((e) => e.id === id)).filter(Boolean)
	};
}
//#endregion
//#region src/lib/validateTree.ts
function validateContext(project) {
	const collections = project.collections ?? [];
	return {
		componentNames: (project.components ?? []).map((c) => c.name),
		collectionNames: collections.map((c) => c.name),
		listFieldNames: collections.flatMap((c) => c.fields.filter((f) => f.type === "multi-reference" || f.type === "multi-image").map((f) => f.name)),
		dataOnlyCollections: collections.filter((c) => c.detailRoutes === false).map((c) => c.name),
		collections,
		pages: project.pages ?? []
	};
}
var SCOPE_TYPES = /* @__PURE__ */ new Set([
	"collection-list",
	"collection-item",
	"slider",
	"body"
]);
function validateTree(root, ctx) {
	const diags = [];
	const refAt = /* @__PURE__ */ new Map();
	const channelAt = /* @__PURE__ */ new Map();
	const collections = ctx.collections;
	const scopeCollectionFor = (outer, arg) => {
		if (!collections || !arg) return null;
		if (arg === "@pages") return pagesListScope(ctx.pages ?? []).collection;
		return resolveListScope(collections, outer ?? null, null, arg, ctx.pages ?? [])?.collection ?? null;
	};
	const visit = (node, parent, scopes, instances, forms) => {
		if (node.ref) {
			if (refAt.has(node.ref)) diags.push({
				nodeId: node.id,
				message: `'#${node.ref}' is already used by another element — refs must be unique on a page`
			});
			else refAt.set(node.ref, node);
			const host = instances[instances.length - 1];
			if (host) diags.push({
				nodeId: node.id,
				message: `'#${node.ref}' is inside the '${host}' component — refs are page-scope, and a component's structure is copied into every instance. Put the ref on the '${host}' element instead.`
			});
		}
		if (node.channel !== void 0 && node.channel !== "") {
			if (!isChannelName(node.channel)) diags.push({
				nodeId: node.id,
				message: `'${node.channel}' is not a channel name — lowercase letters, digits and hyphens, starting with a letter, at most 40 characters (${CHANNEL_NAME_RE.source})`
			});
			else if (channelAt.has(node.channel)) diags.push({
				nodeId: node.id,
				message: `channel '${node.channel}' is already declared by another element here — a channel is site-wide, so two listeners both open and the page shows it twice`
			});
			else channelAt.set(node.channel, node);
			const repeat = [...scopes].reverse().find((s) => s.type === "collection-list" || s.type === "slider" && !!s.arg);
			if (repeat) diags.push({
				nodeId: node.id,
				message: `a channel listener inside '${repeat.type}${repeat.arg ? `[${repeat.arg}]` : ""}' would open once per row — move it outside the list and open the one copy from every row`
			});
			if (isComponentType(node.type)) diags.push({
				nodeId: node.id,
				message: `<${node.type}> emits no element of its own, so it cannot listen on a channel — declare the channel on an element inside ${node.type} instead`
			});
		}
		if (node.type === "list-empty") {
			if (!(!!parent && (parent.type === "collection-list" || parent.type === "slider" && !!parent.arg))) diags.push({
				nodeId: node.id,
				message: "'list-empty' is a list's empty state — it only renders as a DIRECT child of a 'collection-list' or a bound 'slider'. Elsewhere it never renders at all."
			});
		}
		if (node.type === "form-success" || node.type === "form-error") {
			if (parent?.type !== "form") diags.push({
				nodeId: node.id,
				message: `'${node.type}' is a form's ${node.type === "form-success" ? "success" : "error"} state — it only renders as a DIRECT child of a 'form'. Elsewhere it never renders at all.`
			});
			else {
				const twins = (parent.children ?? []).filter((c) => c.type === node.type);
				if (twins.length > 1 && twins[0] !== node) diags.push({
					nodeId: node.id,
					message: `this form already has a '${node.type}' — only the first one renders.`
				});
			}
		}
		if (node.type === "form" && forms.length) diags.push({
			nodeId: node.id,
			message: "a form cannot contain another form — browsers close the outer one, so the inner fields are not submitted."
		});
		if (node.link === "@item") {
			const scope = [...scopes].reverse().find((s) => s.arg && ctx.collectionNames.includes(s.arg));
			if (scope && ctx.dataOnlyCollections.includes(scope.arg)) diags.push({
				nodeId: node.id,
				message: `'@item' links to an entry's own page, but the collection '${scope.arg}' has no detail routes (detailRoutes: false). Remove the link, or give the collection a template page.`
			});
		}
		const scope = scopes[scopes.length - 1];
		const scopeCollection = scope?.collection ?? null;
		if (collections && scopeCollection) {
			const where = scope.type === "body" ? `the '${scopeCollection.name}' template` : `'${scope.type}${scope.arg ? `[${scope.arg}]` : ""}'`;
			const known = (name) => !!resolveBinding(collections, scopeCollection, null, name);
			const names = (scopeCollection.fields ?? []).map((f) => f.name);
			const hint = names.length ? ` (fields here: ${names.join(", ")})` : "";
			if (node.arg && !SCOPE_TYPES.has(node.type) && !known(node.arg)) diags.push({
				nodeId: node.id,
				message: `'${node.arg}' is not a field of ${where}, so this element renders empty${hint}`
			});
			for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) if (field && !known(field)) diags.push({
				nodeId: node.id,
				message: `the '${attr}' attribute is bound to '${field}', which is not a field of ${where} — it renders as the static value, or empty${hint}`
			});
		}
		let childScopes = scopes;
		let childInstances = instances;
		if (node.slot) {
			if (node.type === "body" || isComponentType(node.type) || !node.children) diags.push({
				nodeId: node.id,
				message: `'${node.type}' can't be a slot — a slot is a container inside the component`
			});
			else if (parent === null) diags.push({
				nodeId: node.id,
				message: "The component's own element can't be a slot"
			});
			childInstances = [];
		}
		if (isComponentType(node.type)) {
			if (!ctx.componentNames.includes(node.type)) diags.push({
				nodeId: node.id,
				message: `Unknown component '${node.type}'`
			});
			else {
				if (instances.includes(node.type)) diags.push({
					nodeId: node.id,
					message: `'${node.type}' can't contain itself`
				});
				childInstances = [...instances, node.type];
			}
		} else if (node.type === "collection-list" || node.type === "collection-item") {
			const arg = node.arg;
			if (!(!!arg && (ctx.collectionNames.includes(arg) || node.type === "collection-list" && BUILTIN_LIST_SOURCES.includes(arg) || node.type === "collection-list" && ctx.listFieldNames.includes(arg)))) diags.push({
				nodeId: node.id,
				message: `Unknown collection '${node.type}${arg ? `[${arg}]` : ""}'`
			});
			childScopes = [...scopes, {
				type: node.type,
				arg,
				collection: scopeCollectionFor(scopeCollection, arg)
			}];
		} else if (node.type === "slider") {
			const arg = node.arg;
			if (arg && !ctx.collectionNames.includes(arg) && !BUILTIN_LIST_SOURCES.includes(arg) && !ctx.listFieldNames.includes(arg)) diags.push({
				nodeId: node.id,
				message: `Unknown collection 'slider[${arg}]'`
			});
			if (arg) childScopes = [...scopes, {
				type: node.type,
				arg,
				collection: scopeCollectionFor(scopeCollection, arg)
			}];
		} else if (node.type === "body" && node.arg) childScopes = [...scopes, {
			type: node.type,
			arg: node.arg,
			collection: scopeCollectionFor(null, node.arg)
		}];
		const childForms = node.type === "form" ? [...forms, node] : forms;
		for (const child of node.children) visit(child, node, childScopes, childInstances, childForms);
	};
	visit(root, null, [], [], []);
	return diags;
}
//#endregion
//#region src/lib/treeOps.ts
var pageHost = (body) => ({
	root: body,
	def: null
});
var masterHost = (def) => ({
	root: def.root,
	def
});
function clearBindingsToIds(host, gone) {
	if (!gone.size) return;
	walkNodes([host.root], (n) => {
		if (n.interactions?.length) {
			n.interactions = n.interactions.filter((b) => !b.targetId || !gone.has(b.targetId));
			if (!n.interactions.length) delete n.interactions;
		}
		if (n.animations?.length) {
			n.animations = n.animations.filter((b) => !b.targetId || !gone.has(b.targetId));
			if (!n.animations.length) delete n.animations;
		}
	});
}
//#endregion
//#region src/lib/html/apply.ts
var NEAR_MISS_BINDINGS = /* @__PURE__ */ new Set([
	"data-source",
	"data-collection",
	"data-list",
	"collection",
	"field",
	"data-bind"
]);
var signature = (node) => `${node.type}|${node.arg ?? ""}|${node.link ?? ""}`;
var parsedSignature = (node) => `${node.type}|${argOf(node) ?? ""}|${node.attrs.href ?? ""}`;
function argOf(node) {
	return (SOURCE_TYPES.has(node.type) ? node.attrs.source : node.attrs["data-field"]) || void 0;
}
function lcsAlign(a, b) {
	const n = a.length;
	const m = b.length;
	const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const map = /* @__PURE__ */ new Map();
	let i = 0;
	let j = 0;
	while (i < n && j < m) if (a[i] === b[j]) {
		map.set(j, i);
		i++;
		j++;
	} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
	else j++;
	return map;
}
function applyHtml(root, parsed, opts) {
	const result = {
		kept: 0,
		created: 0,
		removed: 0,
		refused: [],
		warnings: [],
		diagnostics: [],
		carried: []
	};
	const project = opts.project;
	const components = project.components ?? [];
	const host = opts.def ? masterHost(opts.def) : pageHost(root);
	let topAttrs = null;
	let children = parsed;
	if (!opts.asChildren && parsed.length === 1 && sameType(parsed[0].type, root.type)) {
		topAttrs = parsed[0].attrs;
		children = parsed[0].children;
	}
	const before = /* @__PURE__ */ new Set();
	walkNodes([root], (n) => before.add(n.id));
	const mapped = buildInstanceMap$1([root], opts.def ? [opts.def, ...components.filter((c) => c !== opts.def)] : components);
	const refuse = (path, message) => result.refused.push({
		path,
		message
	});
	const warn = (path, message) => result.warnings.push({
		path,
		message
	});
	const reportedClasses = /* @__PURE__ */ new Set();
	const name = (node) => node.ref ? `${node.type}#${node.ref}` : node.type;
	const under = (parent, node) => `${parent} > ${name(node)}`;
	const addressable = [root];
	walkNodes([root], (n) => {
		const mapping = mapped.get(n.id);
		if (!mapping || isInstanceWrapper$1(mapping)) addressable.push(n);
	});
	const byKey = nodesByShortId([root]);
	const known = new Set(byKey.keys());
	for (const [key, node] of [...byKey]) if (!addressable.includes(node)) byKey.delete(key);
	const byRef = /* @__PURE__ */ new Map();
	for (const node of addressable) if (node.ref) byRef.set(node.ref, node);
	const claim = /* @__PURE__ */ new Map();
	const claimed = /* @__PURE__ */ new Set();
	const byPosition = /* @__PURE__ */ new Set();
	const eachParsed = (nodes, visit) => {
		for (const node of nodes) {
			visit(node);
			eachParsed(node.children, visit);
		}
	};
	for (const pass of ["data-id", "data-ref"]) eachParsed(children, (node) => {
		if (claim.has(node)) return;
		const key = node.attrs[pass];
		if (!key) return;
		const found = pass === "data-id" ? byKey.get(key) : byRef.get(key);
		const at = `${name(root)} > ${node.type}`;
		if (!found) {
			if (pass === "data-id" && !known.has(key)) warn(at, `data-id="${key}" matches nothing here, so it carried no identity: this element was matched by position, or created new. Check it against your last read.`);
			return;
		}
		if (claimed.has(found)) {
			refuse(at, `${pass}="${key}" is on two elements in this write. One id is one node: honouring the first would silently move that node — with its interactions and its translations — onto whichever element you listed first. Give the new element no ${pass} and it is created fresh.`);
			return;
		}
		if (!sameType(found.type, node.type)) {
			warn(at, `${pass}="${key}" names a <${found.type}>, not a <${node.type}> — the id is ignored and this element is matched by position instead. To change an element's type, write it without the id (it is a new node), or keep the type and the id together.`);
			return;
		}
		claim.set(node, found);
		claimed.add(found);
	});
	if (topAttrs) applyState(root, {
		...bare(root.type),
		attrs: topAttrs
	}, root.type);
	alignLevel(root, children, name(root));
	const after = /* @__PURE__ */ new Set();
	walkNodes([root], (n) => after.add(n.id));
	const gone = /* @__PURE__ */ new Set();
	for (const id of before) if (!after.has(id)) gone.add(id);
	result.removed = gone.size;
	clearBindingsToIds(host, gone);
	result.diagnostics = validateTree(root, opts.validate ?? contextFromProject(project));
	return result;
	function bare(type) {
		return {
			type,
			tag: type,
			attrs: {},
			children: [],
			line: 0,
			col: 0
		};
	}
	function alignLevel(parent, parsedChildren, path) {
		const freeOld = parent.children.map((node, i) => ({
			node,
			i
		})).filter(({ node }) => !claimed.has(node));
		const freeNew = parsedChildren.map((node, i) => ({
			node,
			i
		})).filter(({ node }) => !claim.has(node));
		for (const signatures of [() => [freeOld.map(({ node }) => signature(node)), freeNew.map(({ node }) => parsedSignature(node))], () => [freeOld.map(({ node }) => node.type), freeNew.map(({ node }) => node.type)]]) {
			const [a, b] = signatures();
			for (const [nj, oj] of lcsAlign(a, b)) {
				const target = freeNew[nj];
				const source = freeOld[oj];
				if (!target || !source) continue;
				if (claim.has(target.node) || claimed.has(source.node)) continue;
				if (!sameType(source.node.type, target.node.type)) continue;
				const wanted = target.node.attrs["data-ref"];
				if (wanted && source.node.ref && wanted !== source.node.ref) continue;
				claim.set(target.node, source.node);
				claimed.add(source.node);
				byPosition.add(target.node);
			}
		}
		const next = [];
		for (const child of parsedChildren) {
			if (child.type === "@slot") {
				refuse(path, "<slot> only fills a component instance's slot — write it as the ONE child of a <Component>, like <Shell><slot>…</slot></Shell>");
				continue;
			}
			let adopted = claim.get(child);
			if (adopted && (adopted === parent || !!findNode([adopted], parent.id))) {
				refuse(`${path} > ${name(adopted)}`, `<${child.tag}> is written inside its own subtree; it is kept where it was and a new element is created here`);
				claim.delete(child);
				adopted = void 0;
			}
			const node = adopted ?? createNode(child.type);
			if (adopted) result.kept++;
			else {
				result.created++;
				claim.set(child, node);
				claimed.add(node);
			}
			const childPath = under(path, node);
			applyState(node, child, child.type, childPath);
			if (adopted && byPosition.has(child)) {
				const interactions = node.interactions?.length ?? 0;
				const animations = node.animations?.length ?? 0;
				if (interactions || animations) result.carried.push({
					id: node.id,
					...node.ref ? { ref: node.ref } : {},
					type: node.type,
					interactions,
					animations
				});
			}
			if (isComponentType(node.type)) fillInstance(node, child, childPath);
			else if (!isLeafType(node.type)) alignLevel(node, child.children, childPath);
			next.push(node);
		}
		parent.children = next;
	}
	function fillInstance(node, parsed, path) {
		const def = components.find((c) => c.name === node.type);
		if (!def) return;
		if (opts.def && !canNest$1(components, opts.def.name, def.name)) {
			refuse(path, `<${def.name}> can't go inside <${opts.def.name}>: a component can't hold itself`);
			return;
		}
		alignStructure(node, def.root);
		if (!parsed.children.length) return;
		if (parsed.children.length === 1 && parsed.children[0].type === "@slot") {
			const marker = parsed.children[0];
			const slots = [];
			const findSlots = (instance, master) => {
				const length = Math.min(instance.length, master.length);
				for (let i = 0; i < length; i++) {
					const below = master[i];
					const target = instance[i];
					if (below.slot) slots.push({
						instance: target,
						master: below
					});
					else if (!isComponentType(below.type)) findSlots(target.children, below.children);
				}
			};
			findSlots(node.children, def.root.children);
			if (slots.length !== 1) {
				refuse(path, slots.length === 0 ? `<${def.name}> has no slot, so <slot> has nothing to fill here. Write its parts out, or mark a container in the component as a slot (edit_elements {componentId, slot: true}).` : `<${def.name}> has ${slots.length} slots, and <slot> cannot say which one. Write its parts out so each one is addressed by position.`);
				return;
			}
			const slot = slots[0];
			alignLevel(slot.instance, marker.children, under(path, slot.instance));
			return;
		}
		const fill = (instance, master, written, at, owner) => {
			if (written.length !== master.length) {
				refuse(at, `<${owner}> has ${master.length} part${master.length === 1 ? "" : "s"} here and ${written.length} ${written.length === 1 ? "was" : "were"} written. Write <${owner} /> to leave its parts alone, or change the component itself with update_component.`);
				return;
			}
			written.forEach((child, i) => {
				const target = instance[i];
				const below = master[i];
				if (!target || !below) return;
				const childPath = under(at, target);
				if (child.type === "@slot") {
					refuse(childPath, `<slot> cannot sit beside written-out parts of <${owner}> — either write <slot> as the one child of <${owner}>, or address this slot by position with its own tag`);
					return;
				}
				if (!sameType(target.type, child.type)) {
					refuse(childPath, `part ${i + 1} of <${owner}> is a <${target.type}>, not a <${child.tag}>`);
					return;
				}
				fillPart(target, child, owner, childPath);
				if (below.slot) alignLevel(target, child.children, childPath);
				else fill(target.children, below.children, child.children, childPath, isComponentType(below.type) ? below.type : owner);
			});
		};
		fill(node.children, def.root.children, parsed.children, path, def.name);
	}
	function fillPart(node, parsed, component, path) {
		const shared = (attr, current) => {
			if ((parsed.attrs[attr] ?? "") === (current ?? "")) return;
			refuse(path, `'${attr}' inside <${component}> is the component's, not this instance's — change it with update_component`);
		};
		const implied = impliedAttrs(node.type);
		for (const [attr, value] of Object.entries(parsed.attrs)) switch (true) {
			case attr === "data-id":
			case attr === "data-type":
			case attr === "data-interactions":
			case attr === "data-animations": break;
			case implied[attr] !== void 0: break;
			case attr === "id":
				assign(node, "htmlId", value);
				break;
			case attr === "src":
				setSrc(node, value, path);
				break;
			case attr === "alt": {
				const attrs = { ...node.instanceAttributes ?? {} };
				if (value) attrs.alt = value;
				else delete attrs.alt;
				assignObject(node, "instanceAttributes", attrs);
				break;
			}
			case attr === "data-hidden":
				setHidden(node, value);
				break;
			case attr === "data-slot": break;
			case attr === "data-channel":
				if ((value || "") !== (node.channel || "")) refuse(path, `the channel is <${component}>'s, not this instance's — change it with update_component`);
				break;
			case attr === "data-icon":
				setIcon(node, value, path);
				break;
			case attr.startsWith("data-bind-"):
				setFieldAttr(node, attr.slice(10), value, path);
				break;
			case attr === "data-ref":
				refuse(path, `a ref inside a component instance would be duplicated on every instance — put it on the <${component}> element instead`);
				break;
			case attr === "class":
				refuse(path, `a class inside <${component}> renders nowhere: a mapped node wears the component's. Style the component instead.`);
				break;
			case attr === "href":
				assign(node, "link", value);
				break;
			case attr === "source":
				shared(attr, node.arg);
				break;
			case attr === "data-field":
				if ((parsed.attrs["data-field"] ?? "") !== (node.arg ?? "")) refuse(path, `'data-field' inside <${component}> would bind EVERY <${component}> on the site to that field — a binding is the component's, not this instance's. Draw the per-entry value with an element the page (or the surrounding component) owns, beside the <${component}> rather than inside it.`);
				break;
			case NEAR_MISS_BINDINGS.has(attr):
				refuse(path, `'${attr}' binds nothing — a field binding is 'data-field'`);
				break;
			default: shared(attr, node.attributes?.[attr]);
		}
		const has = (attr) => parsed.attrs[attr] !== void 0;
		if (!has("id") && node.htmlId !== void 0) delete node.htmlId;
		if (!has("src") && node.src !== void 0) delete node.src;
		if (!has("href") && node.link !== void 0) delete node.link;
		if (!has("data-hidden") && node.hidden !== void 0) delete node.hidden;
		if (!has("alt") && node.instanceAttributes?.alt !== void 0) {
			const attrs = { ...node.instanceAttributes };
			delete attrs.alt;
			assignObject(node, "instanceAttributes", attrs);
		}
		const fields = {};
		for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) if (has(`data-bind-${attr}`)) fields[attr] = field;
		assignObject(node, "fieldAttrs", fields);
		if (parsed.text !== void 0 && isLeafType(node.type)) setContent(node, parsed, path);
	}
	function applyState(node, parsed, type, path = name(node)) {
		const isInstance = isComponentType(type);
		if (!sameType(node.type, type)) node.type = type;
		const implied = impliedAttrs(type);
		for (const [attr, value] of Object.entries(parsed.attrs)) switch (true) {
			case attr === "data-id":
			case attr === "data-type":
			case attr === "data-interactions":
			case attr === "data-animations": break;
			case implied[attr] !== void 0: break;
			case attr === "data-ref":
				setRef(node, value, path);
				break;
			case attr === "data-slot":
				setSlot(node, parsed, path);
				break;
			case attr === "data-channel":
				setChannel(node, value, isInstance, parsed.tag, path);
				break;
			case attr === "class":
				if (isInstance) refuse(path, `a class on <${parsed.tag}> renders nowhere: an instance wrapper emits no element of its own, and its look is the component's. Style the component instead.`);
				else setClasses(node, value, path);
				break;
			case attr === "id":
				assign(node, "htmlId", value);
				break;
			case attr === "source":
				if (!SOURCE_TYPES.has(type)) refuse(path, `<${parsed.tag}> takes no 'source'; a field binding is 'data-field'`);
				else assign(node, "arg", value);
				break;
			case attr === "data-field":
				if (SOURCE_TYPES.has(type)) refuse(path, `<${parsed.tag}> binds a whole collection with 'source', not 'data-field'`);
				else if (isInstance) refuse(path, `<${parsed.tag}> emits no element, so it has nothing to bind`);
				else assign(node, "arg", value);
				break;
			case attr === "href":
				if (isInstance) refuse(path, `<${parsed.tag}> emits no element, so it has no link`);
				else assign(node, "link", value);
				break;
			case attr === "src":
				setSrc(node, value, path);
				break;
			case attr === "data-hidden":
				setHidden(node, value);
				break;
			case attr === "data-icon":
				setIcon(node, value, path);
				break;
			case NEAR_MISS_BINDINGS.has(attr):
				refuse(path, SOURCE_TYPES.has(type) ? `'${attr}' binds nothing — <${parsed.tag}> takes a whole collection as 'source'` : `'${attr}' binds nothing — a field binding is 'data-field'`);
				break;
			case attr.startsWith("data-bind-"):
				setFieldAttr(node, attr.slice(10), value, path);
				break;
			case attr.startsWith("data-variant-"):
				if (!isInstance) refuse(path, `only a component instance wears a variant; <${parsed.tag}> does not`);
				else setVariant(node, attr.slice(13), value);
				break;
			default: if (isInstance) refuse(path, `'${attr}' on <${parsed.tag}> belongs to the component — change it with update_component, or use edit_elements {instanceAttributes} for this placement`);
			else if (!isAllowedAttribute(attr)) refuse(path, `'${attr}' is not an allowed attribute`);
			else setAttr(node, attr, value);
		}
		pruneAbsent(node, parsed, isInstance, () => path);
		if (!isInstance && isLeafType(type) && parsed.text !== void 0) setContent(node, parsed, path);
	}
	function pruneAbsent(node, parsed, isInstance, pathFor) {
		const has = (attr) => parsed.attrs[attr] !== void 0;
		if (!has("data-ref") && node.ref !== void 0) delete node.ref;
		if (!has("id") && node.htmlId !== void 0) delete node.htmlId;
		if (!has("data-hidden") && node.hidden !== void 0) delete node.hidden;
		if (!has("data-channel") && node.channel !== void 0) delete node.channel;
		if (opts.def && !has("data-slot") && node.slot !== void 0) delete node.slot;
		if (!has(SOURCE_TYPES.has(node.type) ? "source" : "data-field") && node.arg !== void 0) delete node.arg;
		if (isInstance) {
			const written = /* @__PURE__ */ new Map();
			for (const [attr, value] of Object.entries(parsed.attrs)) if (attr.startsWith("data-variant-")) written.set(attr.slice(13), value);
			const picks = {};
			for (const axis of Object.keys(node.variants ?? {})) {
				const value = written.get(axis);
				if (value) picks[axis] = value;
				written.delete(axis);
			}
			for (const [axis, value] of written) if (value) picks[axis] = value;
			assignObject(node, "variants", picks);
			return;
		}
		if (node.variants !== void 0) delete node.variants;
		if (!has("href") && node.link !== void 0) delete node.link;
		if (!has("class") && node.classes !== void 0) {
			if (node.classes.trim()) warn(pathFor(node), `had classes ("${node.classes.trim()}") and the markup gives it none, so they are gone. Write \`class=""\` if that was deliberate; otherwise echo the classes back.`);
			delete node.classes;
		}
		if (!has("src") && node.src !== void 0) delete node.src;
		const implied = impliedAttrs(node.type);
		const attrs = {};
		for (const [attr, value] of Object.entries(node.attributes ?? {})) if (has(attr) || implied[attr] !== void 0) attrs[attr] = value;
		assignObject(node, "attributes", attrs);
		const fields = {};
		for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) if (has(`data-bind-${attr}`)) fields[attr] = field;
		assignObject(node, "fieldAttrs", fields);
	}
	function setRef(node, value, path) {
		const ref = value.trim();
		if (!ref) {
			delete node.ref;
			return;
		}
		if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(ref)) {
			refuse(path, `'${ref}' is not a valid ref — letters, digits and '-', starting with a letter`);
			return;
		}
		if (node.type === "body") {
			refuse(path, "<body> carries no ref: it is the page root and is already addressable");
			return;
		}
		const mapping = mapped.get(node.id);
		if (mapping && !isInstanceWrapper$1(mapping)) {
			refuse(path, `a ref inside a component instance would be duplicated on every instance — put it on the <${mapping.def.name}> element instead`);
			return;
		}
		assign(node, "ref", ref);
		byRef.set(ref, node);
	}
	function setClasses(node, value, path) {
		const tokens = value.split(/\s+/).filter(Boolean);
		const unmodelled = tokens.filter((t) => !isValidClass(t) && !reportedClasses.has(t));
		if (unmodelled.length) {
			for (const t of unmodelled) reportedClasses.add(t);
			warn(path, `${unmodelled.map((t) => `'${t}'`).join(", ")} ${unmodelled.length === 1 ? "is" : "are"} kept, but the Style panel has no control for ${unmodelled.length === 1 ? "it" : "them"}`);
		}
		assign(node, "classes", tokens.join(" "));
	}
	function setSrc(node, value, path) {
		if (value === "data:…(elided)") return;
		if (value && !SAFE_SRC.test(value)) {
			refuse(path, `'${value}' is not a usable media URL — upload one with upload_media`);
			return;
		}
		assign(node, "src", value);
	}
	function setAttr(node, attr, value) {
		assignObject(node, "attributes", sanitizeAttributes({
			...node.attributes ?? {},
			[attr]: value
		}));
	}
	function setFieldAttr(node, attr, field, path) {
		if (isComponentType(node.type)) {
			refuse(path, "an instance wrapper emits no element, so an attribute has nowhere to land");
			return;
		}
		if (!isAllowedAttribute(attr)) {
			refuse(path, `'${attr}' is not an allowed attribute, so it can't be bound to a field`);
			return;
		}
		const next = { ...node.fieldAttrs ?? {} };
		if (field) next[attr] = field;
		else delete next[attr];
		assignObject(node, "fieldAttrs", next);
	}
	function setVariant(node, axis, option) {
		const next = { ...node.variants ?? {} };
		if (option) next[axis] = option;
		else delete next[axis];
		assignObject(node, "variants", next);
	}
	function setContent(node, parsed, path) {
		const raw = parsed.text ?? "";
		const text = node.type === "custom-code" ? raw.includes("<") ? raw : decodeEntities(raw) : isRich(raw) ? sanitizeRich(raw) : decodeEntities(raw);
		if (!isLeafElement(node.type) && text.trim()) {
			refuse(path, `<${parsed.tag}> is a container — its words go in a child element`);
			return;
		}
		assign(node, "content", text);
	}
	function setSlot(node, parsed, path) {
		if (!opts.def) return;
		if (node === root) {
			refuse(path, "the component's own element can't be a slot — mark a container inside it");
			return;
		}
		if (isComponentType(node.type) || isLeafType(node.type)) {
			refuse(path, `<${parsed.tag}> can't be a slot: a slot is a container of this component's own (a <div>, a <section>…) whose children each instance fills`);
			return;
		}
		if (!node.slot) node.slot = true;
	}
	function setChannel(node, value, isInstance, tag, path) {
		if (isInstance) {
			refuse(path, `<${tag}> emits no element of its own, so it cannot listen on a channel — declare it on an element inside ${tag} with update_component`);
			return;
		}
		if (value === "") {
			delete node.channel;
			return;
		}
		if (!isChannelName(value)) {
			refuse(path, `'${value}' is not a channel name — lowercase letters, digits and hyphens, starting with a letter, at most 40 characters`);
			return;
		}
		assign(node, "channel", value);
	}
	function setHidden(node, value) {
		const next = value !== "false";
		if (node.hidden !== next) node.hidden = next;
	}
	function setIcon(node, value, path) {
		const name = value.trim();
		if (!name || name === iconNameOf(node) || name === "custom") return;
		const markup = opts.resolveIcon?.(name);
		if (markup) {
			node.svg = markup;
			return;
		}
		refuse(path, opts.resolveIcon ? `no bundled icon named "${name}" — find one with list_icons, or set custom markup with edit_elements {svg}` : `an icon's markup is not in the HTML here — set it with edit_elements {icon: "${name}"}`);
	}
	function assign(node, key, value) {
		const next = key === "content" ? value : value.trim();
		if (!next && key !== "content") {
			if (node[key] !== void 0) delete node[key];
			return;
		}
		if (node[key] !== next) node[key] = next;
	}
	function assignObject(node, key, value) {
		if (!Object.keys(value).length) {
			if (node[key] !== void 0) delete node[key];
			return;
		}
		if (JSON.stringify(node[key]) !== JSON.stringify(value)) node[key] = value;
	}
}
var iconNameOf = (node) => node.svg?.match(/data-icon="([a-z0-9:_-]+)"/)?.[1] ?? (node.svg ? "custom" : "");
function contextFromProject(project) {
	return validateContext(project);
}
//#endregion
//#region src/lib/shared/slug.js
/**
* normalizes a string into a url slug segment
* @param {string} value
* @returns {string}
*/
function slugify(value) {
	return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
/**
* an entry's own slug, or one derived from its name (older entries)
* @param {{ slug?: string, name: string }} entry
* @returns {string}
*/
var entrySlug = (entry) => entry.slug || slugify(entry.name);
/**
* The path prefix a collection's entry routes live under.
*
* Defaults to the collection's own name (`/post/<slug>`). A collection may set
* `routeBase` to move them — `''` puts entries at the site root (`/<slug>`,
* the WordPress-style layout a real port often has to reproduce). The base is
* slugified, so it can never escape the output directory.
* @param {{ name: string, routeBase?: string }} collection
* @returns {string} '' for root-level, else a slug segment path with no slashes at the edges
*/
function collectionRouteBase(collection) {
	const raw = collection?.routeBase;
	if (raw === void 0 || raw === null) return slugify(collection?.name ?? "");
	return String(raw).split("/").map(slugify).filter(Boolean).join("/");
}
/**
* Does this collection publish a page per entry at all?
*
* `detailRoutes: false` is a data-only collection — a board roster, an FAQ set:
* content that is rendered INSIDE other pages and has no page of its own. Before
* this existed, every collection claimed routes whether or not anything linked
* to them, so a data-only collection had to keep a draft template page and live
* with a publish warning about 404s that could not happen.
* @param {{ detailRoutes?: boolean }} collection
* @returns {boolean}
*/
function hasDetailRoutes(collection) {
	return collection?.detailRoutes !== false;
}
/**
* The site path of one entry, or null when its collection has no detail routes.
* @param {{ name: string, routeBase?: string, detailRoutes?: boolean }} collection
* @param {{ slug?: string, name: string }} entry
* @returns {string|null}
*/
function entryRoutePath(collection, entry) {
	if (entry?.routePath) return entry.routePath;
	if (!hasDetailRoutes(collection)) return null;
	const base = collectionRouteBase(collection);
	return `/${base ? `${base}/` : ""}${entrySlug(entry)}`;
}
//#endregion
//#region src/lib/shared/structuredData.js
function customSchemaError(text) {
	const raw = String(text ?? "").trim();
	if (!raw) return null;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return "Not valid JSON" + (e instanceof Error ? `: ${e.message}` : "");
	}
	const items = Array.isArray(parsed) ? parsed : [parsed];
	for (const item of items) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return "Each entry must be a JSON object";
		if (typeof item["@type"] !== "string") return "Each entry needs a string \"@type\"";
	}
	return null;
}
//#endregion
//#region src/lib/shared/svg.js
var MAX_SVG_BYTES = 32768;
var canonical = (names) => new Map(names.map((n) => [n.toLowerCase(), n]));
var ELEMENTS$1 = canonical([
	"svg",
	"g",
	"path",
	"circle",
	"ellipse",
	"rect",
	"line",
	"polyline",
	"polygon",
	"defs",
	"clipPath",
	"mask",
	"linearGradient",
	"radialGradient",
	"stop",
	"title",
	"desc"
]);
var TEXT_ELEMENTS = /* @__PURE__ */ new Set(["title", "desc"]);
var ATTRIBUTES = canonical([
	"d",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"x",
	"y",
	"x1",
	"y1",
	"x2",
	"y2",
	"points",
	"width",
	"height",
	"viewBox",
	"transform",
	"pathLength",
	"preserveAspectRatio",
	"fill",
	"stroke",
	"opacity",
	"fill-opacity",
	"fill-rule",
	"clip-rule",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"stroke-dashoffset",
	"stroke-miterlimit",
	"stroke-opacity",
	"clip-path",
	"mask",
	"offset",
	"stop-color",
	"stop-opacity",
	"gradientUnits",
	"gradientTransform",
	"fx",
	"fy",
	"spreadMethod",
	"clipPathUnits",
	"maskUnits",
	"maskContentUnits",
	"id",
	"role",
	"aria-hidden",
	"aria-label",
	"data-icon"
]);
var VALUE_RE = /^[A-Za-z0-9\s.,#%()+\-_/:]*$/;
var LOCAL_URL_RE = /^url\(#[A-Za-z0-9_-]+\)$/;
var ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
var URL_ATTRIBUTES = /* @__PURE__ */ new Set([
	"fill",
	"stroke",
	"clip-path",
	"mask"
]);
var TOKEN_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[^>]*>|[^<]+|</g;
var TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)(\/?)>$/;
var ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
var escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function cleanValue(name, raw) {
	const value = String(raw ?? "").trim();
	if (!VALUE_RE.test(value)) return void 0;
	if (name === "id") return ID_RE.test(value) ? value : void 0;
	if (/url\s*\(/i.test(value)) return URL_ATTRIBUTES.has(name) && LOCAL_URL_RE.test(value) ? value : void 0;
	if (name === "data-icon") return /^[a-z][a-z0-9-]*:[a-z0-9-]+$/.test(value) ? value : void 0;
	if (value.includes(":")) return void 0;
	return value;
}
function cleanAttributes(source, { recolor }) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const m of source.matchAll(ATTR_RE)) {
		const name = ATTRIBUTES.get(m[1].toLowerCase());
		if (!name || seen.has(name)) continue;
		let value = cleanValue(name, m[2] ?? m[3] ?? m[4] ?? "");
		if (value === void 0) continue;
		if (recolor && (name === "fill" || name === "stroke" || name === "stop-color")) {
			if (value !== "none") value = "currentColor";
		}
		seen.add(name);
		out.push([name, value]);
	}
	return out;
}
var writeAttributes = (attrs) => attrs.map(([k, v]) => ` ${k}="${v}"`).join("");
function sanitizeInlineSvg(markup, { recolor = true } = {}) {
	if (typeof markup !== "string" || !markup || markup.length > 32768) return "";
	const out = [];
	const open = [];
	let skipping = null;
	let skipDepth = 0;
	let closed = false;
	for (const token of markup.match(TOKEN_RE) ?? []) {
		if (closed) break;
		if (token[0] !== "<" || token.length === 1) {
			const parent = open[open.length - 1];
			if (!skipping && parent && TEXT_ELEMENTS.has(parent)) out.push(escapeText(token));
			continue;
		}
		const tag = token.match(TAG_RE);
		if (!tag) continue;
		const closing = tag[1] === "/";
		const rawName = tag[2].toLowerCase();
		const selfClosing = tag[4] === "/";
		if (skipping) {
			if (rawName !== skipping) continue;
			if (closing) {
				if (--skipDepth === 0) skipping = null;
			} else if (!selfClosing) skipDepth++;
			continue;
		}
		const name = ELEMENTS$1.get(rawName);
		if (!name) {
			if (!closing && !selfClosing) {
				skipping = rawName;
				skipDepth = 1;
			}
			continue;
		}
		if (closing) {
			const at = open.lastIndexOf(name);
			if (at === -1) continue;
			for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`);
			open.length = at;
			if (!open.length) closed = true;
			continue;
		}
		if (!open.length ? name !== "svg" : name === "svg") {
			if (!open.length) return "";
			if (!selfClosing) {
				skipping = rawName;
				skipDepth = 1;
			}
			continue;
		}
		const attrs = cleanAttributes(tag[3], { recolor });
		if (name === "svg") normalizeRoot(attrs, { recolor });
		if (selfClosing) {
			out.push(`<${name}${writeAttributes(attrs)}/>`);
			if (name === "svg") closed = true;
		} else {
			out.push(`<${name}${writeAttributes(attrs)}>`);
			open.push(name);
		}
	}
	for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);
	const result = out.join("");
	return result.startsWith("<svg") ? result : "";
}
function normalizeRoot(attrs, { recolor }) {
	const get = (k) => attrs.find(([name]) => name === k)?.[1];
	if (!get("viewBox")) {
		const w = Number.parseFloat(get("width") ?? "");
		const h = Number.parseFloat(get("height") ?? "");
		if (w > 0 && h > 0) attrs.push(["viewBox", `0 0 ${w} ${h}`]);
	}
	if (recolor && !get("fill")) attrs.push(["fill", "currentColor"]);
}
function parseInlineSvg(markup) {
	if (typeof markup !== "string") return null;
	const m = markup.match(/^<svg([^>]*?)(?:\/>|>([\s\S]*)<\/svg>)$/);
	if (!m) return null;
	const attrs = {};
	for (const a of m[1].matchAll(/ ([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g)) attrs[a[1]] = a[2];
	return {
		attrs,
		inner: m[2] ?? ""
	};
}
var LUCIDE_ROOT = "width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"";
function lucideSvg(name, inner) {
	return sanitizeInlineSvg(`<svg data-icon="lucide:${name}" ${LUCIDE_ROOT}>${inner}</svg>`);
}
function lucideNameOf(markup) {
	const icon = parseInlineSvg(markup)?.attrs["data-icon"];
	return icon?.startsWith("lucide:") ? icon.slice(7) : void 0;
}
lucideSvg("circle", "<circle cx=\"12\" cy=\"12\" r=\"10\"/>");
//#endregion
//#region src/lib/variantOps.ts
var fail$2 = (error) => ({
	ok: false,
	error
});
var OK = { ok: true };
function nameError(kind, name) {
	if (VARIANT_NAME_RE.test(name)) return null;
	return `An ${kind} name is lowercase letters, digits and dashes, starting with a letter`;
}
function instancesOf(project, def) {
	const out = [];
	const collect = (nodes) => walkNodes(nodes, (n) => {
		if (n.type === def.name) out.push(n);
	});
	for (const page of project.pages) collect(page.elements);
	for (const other of project.components) if (other !== def) collect(other.root.children);
	return out;
}
function rewrite(project, def, next, renames = {}) {
	const before = def.variants ?? [];
	const oldAxisName = (axis) => renames.axes?.[axis] ?? axis;
	const oldOptionName = (axis, option) => renames.options?.[axis]?.[option] ?? option;
	setComponentMeta(def, {
		category: def.category,
		variants: next
	});
	walkNodes([def.root], (node) => {
		const old = node.variantClasses;
		if (!old) return;
		const kept = {};
		for (const axis of next) for (const option of axis.options) {
			const classes = old[variantKey(oldAxisName(axis.name), oldOptionName(axis.name, option))]?.trim();
			if (classes) kept[variantKey(axis.name, option)] = classes;
		}
		if (Object.keys(kept).length) node.variantClasses = kept;
		else delete node.variantClasses;
	});
	for (const instance of instancesOf(project, def)) {
		const old = instance.variants ?? {};
		const kept = {};
		for (const axis of next) {
			const was = before.find((a) => a.name === oldAxisName(axis.name));
			const wore = was ? old[was.name] ?? was.default : void 0;
			const now = axis.options.find((option) => oldOptionName(axis.name, option) === wore);
			if (now !== void 0 && now !== axis.default) kept[axis.name] = now;
		}
		if (Object.keys(kept).length) instance.variants = kept;
		else delete instance.variants;
	}
}
var axesOf = (def) => (def.variants ?? []).map((a) => ({
	name: a.name,
	options: [...a.options],
	default: a.default
}));
function addVariantAxis(project, def, name, options = ["default"]) {
	const axes = axesOf(def);
	const bad = nameError("axis", name) ?? options.map((o) => nameError("option", o)).find(Boolean);
	if (bad) return fail$2(bad);
	if (axes.some((a) => a.name === name)) return fail$2(`This component already has a "${name}" axis`);
	if (!options.length) return fail$2("An axis needs at least one option");
	if (new Set(options).size !== options.length) return fail$2("Option names must be unique");
	rewrite(project, def, [...axes, {
		name,
		options: [...options],
		default: options[0]
	}]);
	return OK;
}
function renameVariantAxis(project, def, from, to) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === from);
	if (!axis) return fail$2(`No "${from}" axis`);
	if (from === to) return OK;
	const bad = nameError("axis", to);
	if (bad) return fail$2(bad);
	if (axes.some((a) => a.name === to)) return fail$2(`This component already has a "${to}" axis`);
	axis.name = to;
	rewrite(project, def, axes, { axes: { [to]: from } });
	return OK;
}
function removeVariantAxis(project, def, name) {
	const axes = axesOf(def);
	if (!axes.some((a) => a.name === name)) return fail$2(`No "${name}" axis`);
	rewrite(project, def, axes.filter((a) => a.name !== name));
	return OK;
}
function addVariantOption(project, def, axisName, option) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis) return fail$2(`No "${axisName}" axis`);
	const bad = nameError("option", option);
	if (bad) return fail$2(bad);
	if (axis.options.includes(option)) return fail$2(`"${axisName}" already has a "${option}" option`);
	axis.options.push(option);
	rewrite(project, def, axes);
	return OK;
}
function renameVariantOption(project, def, axisName, from, to) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis || !axis.options.includes(from)) return fail$2(`No "${from}" option on "${axisName}"`);
	if (from === to) return OK;
	const bad = nameError("option", to);
	if (bad) return fail$2(bad);
	if (axis.options.includes(to)) return fail$2(`"${axisName}" already has a "${to}" option`);
	axis.options = axis.options.map((o) => o === from ? to : o);
	if (axis.default === from) axis.default = to;
	rewrite(project, def, axes, { options: { [axisName]: { [to]: from } } });
	return OK;
}
function removeVariantOption(project, def, axisName, option) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis || !axis.options.includes(option)) return fail$2(`No "${option}" option on "${axisName}"`);
	if (axis.options.length === 1) return fail$2("An axis needs at least one option — remove the axis instead");
	axis.options = axis.options.filter((o) => o !== option);
	if (axis.default === option) axis.default = axis.options[0];
	rewrite(project, def, axes);
	return OK;
}
function setVariantDefault(project, def, axisName, option) {
	const axes = axesOf(def);
	const axis = axes.find((a) => a.name === axisName);
	if (!axis || !axis.options.includes(option)) return fail$2(`No "${option}" option on "${axisName}"`);
	axis.default = option;
	rewrite(project, def, axes);
	return OK;
}
function setVariantAxes(project, def, axes) {
	const seen = /* @__PURE__ */ new Set();
	for (const axis of axes) {
		const bad = nameError("axis", axis.name) ?? axis.options.map((o) => nameError("option", o)).find(Boolean);
		if (bad) return fail$2(bad);
		if (seen.has(axis.name)) return fail$2(`Two axes are named "${axis.name}"`);
		seen.add(axis.name);
		if (!axis.options.length) return fail$2(`"${axis.name}" needs at least one option`);
		if (new Set(axis.options).size !== axis.options.length) return fail$2(`"${axis.name}" has two options with the same name`);
		if (!axis.options.includes(axis.default)) return fail$2(`"${axis.name}": the default "${axis.default}" is not one of its options`);
	}
	rewrite(project, def, axes);
	return OK;
}
function setInstancePick(def, wrapper, axisName, option, mirrors = []) {
	const axis = def.variants?.find((a) => a.name === axisName);
	if (!axis) return fail$2(`"${def.name}" has no "${axisName}" axis`);
	if (option !== null && !axis.options.includes(option)) return fail$2(`"${axisName}" has no "${option}" option — it has ${axis.options.join(", ")}`);
	const picks = { ...wrapper.variants ?? {} };
	const inherited = resolvePicks(def, { variants: {} }, mirrors)[axisName];
	if (option === null || option === inherited) delete picks[axisName];
	else picks[axisName] = option;
	const kept = {};
	for (const a of def.variants ?? []) if (picks[a.name] !== void 0) kept[a.name] = picks[a.name];
	if (Object.keys(kept).length) wrapper.variants = kept;
	else delete wrapper.variants;
	return OK;
}
function setVariantClasses(def, node, key, classes) {
	const next = {
		...node.variantClasses ?? {},
		[key]: classes.trim()
	};
	const kept = {};
	for (const axis of def.variants ?? []) for (const option of axis.options) {
		const k = variantKey(axis.name, option);
		if (next[k]) kept[k] = next[k];
	}
	if (Object.keys(kept).length) node.variantClasses = kept;
	else delete node.variantClasses;
}
//#endregion
//#region src/lib/shared/entryScope.js
/**
* Which nodes a route renders under an ENTRY SCOPE, and which scope.
*
* A node is in an entry scope when it is repeated or embedded per entry: inside
* a `:collection-list`, inside a bound `:slider`, or in the template body a
* `:collection-item` embeds. Everything else renders ONCE per route.
*
* This is what decides whether a binding's state key carries the entry part.
* The entry part is carried only when a binding's OWNER and its TARGET share a
* scope — both inside one repeat (a per-row effect, independent per row) or
* both outside every repeat (one shared effect). A row button that opens one
* sheet outside the list therefore keys its effect exactly the way the sheet
* keys it. Keyed off the trigger alone, the button wrote `X@e<row>` while the
* sheet listened on `X`, so the click silently did nothing — which made the
* "ONE overlay per kind, outside the list" recipe unbuildable.
*
* @param {Array<{tree: any[], root: string|null}>} trees
* @returns {Map<string, string>} node id → scope root id (absent = no scope)
*/
function buildScopeRoots(trees) {
	const index = /* @__PURE__ */ new Map();
	const walk = (nodes, root) => {
		for (const n of nodes ?? []) {
			if (root) index.set(n.id, root);
			walk(n.children, isEntryScopeRoot(n) ? n.id : root);
		}
	};
	for (const { tree, root } of trees) walk(tree, root ?? null);
	return index;
}
function isEntryScopeRoot(node) {
	return node.type === "collection-list" || node.type === "slider" && !!node.arg;
}
//#endregion
//#region src/lib/shared/locales.js
function purgeLocaleSeo(project, code) {
	for (const page of project.pages ?? []) {
		const seo = page.seo;
		if (!seo?.locales?.[code]) continue;
		delete seo.locales[code];
		if (!Object.keys(seo.locales).length) delete seo.locales;
		if (!Object.keys(seo).length) delete page.seo;
	}
	const settingsSeo = project.settings?.seo;
	if (settingsSeo?.locales?.[code]) {
		delete settingsSeo.locales[code];
		if (!Object.keys(settingsSeo.locales).length) delete settingsSeo.locales;
	}
}
function countLocaleSeo(project, code) {
	let n = 0;
	for (const page of project.pages ?? []) if (page.seo?.locales?.[code]) n++;
	if (project.settings?.seo?.locales?.[code]) n++;
	return n;
}
//#endregion
//#region src/lib/shared/motion.js
var LENGTH_UNITS = [
	"px",
	"%",
	"em",
	"rem",
	"vw",
	"vh"
];
var MOTION_PROPS = {
	x: {
		kind: "transform",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Move X"
	},
	y: {
		kind: "transform",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Move Y"
	},
	scale: {
		kind: "transform",
		unit: "",
		units: [],
		def: 1,
		label: "Scale"
	},
	rotate: {
		kind: "transform",
		unit: "deg",
		units: ["deg"],
		def: 0,
		label: "Rotate"
	},
	opacity: {
		kind: "opacity",
		unit: "",
		units: [],
		def: 1,
		label: "Opacity"
	},
	blur: {
		kind: "filter",
		unit: "px",
		units: [
			"px",
			"em",
			"rem"
		],
		def: 0,
		label: "Blur"
	},
	brightness: {
		kind: "filter",
		unit: "",
		units: [],
		def: 1,
		label: "Brightness"
	},
	saturate: {
		kind: "filter",
		unit: "",
		units: [],
		def: 1,
		label: "Saturate"
	},
	bgColor: {
		kind: "color",
		css: "backgroundColor",
		unit: "",
		units: [],
		def: "#00000000",
		label: "Background"
	},
	textColor: {
		kind: "color",
		css: "color",
		unit: "",
		units: [],
		def: "#00000000",
		label: "Text color"
	},
	borderColor: {
		kind: "color",
		css: "borderColor",
		unit: "",
		units: [],
		def: "#00000000",
		label: "Border color"
	},
	width: {
		kind: "size",
		css: "width",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Width"
	},
	height: {
		kind: "size",
		css: "height",
		unit: "px",
		units: LENGTH_UNITS,
		def: 0,
		label: "Height"
	},
	clipTop: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip top"
	},
	clipRight: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip right"
	},
	clipBottom: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip bottom"
	},
	clipLeft: {
		kind: "clip",
		unit: "%",
		units: ["%", "px"],
		def: 0,
		label: "Clip left"
	},
	count: {
		kind: "text",
		unit: "",
		units: [],
		def: 0,
		label: "Count"
	}
};
var c1 = 1.70158;
var c3 = 2.70158;
var c4 = 2 * Math.PI / 3;
var EASINGS = {
	linear: (t) => t,
	"ease-in": (t) => t * t * t,
	"ease-out": (t) => 1 - Math.pow(1 - t, 3),
	"ease-in-out": (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
	"quad-in": (t) => t * t,
	"quad-out": (t) => 1 - (1 - t) * (1 - t),
	"quart-in": (t) => t * t * t * t,
	"quart-out": (t) => 1 - Math.pow(1 - t, 4),
	"quart-in-out": (t) => t < .5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,
	"back-out": (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
	"elastic-out": (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * c4) + 1,
	"bounce-out": (t) => {
		const n1 = 7.5625;
		const d1 = 2.75;
		if (t < 1 / d1) return n1 * t * t;
		if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + .75;
		if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + .9375;
		return n1 * (t -= 2.625 / d1) * t + .984375;
	}
};
var EASING_KEYS = Object.keys(EASINGS);
var ANIMATION_ACTIONS = [
	"toggle",
	"on",
	"off"
];
var NUMBER_UNIT_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z%]*)\s*$/i;
/**
* Splits a track value into a number and a unit. Numbers adopt the property's
* default unit; strings carry their own. Returns null when unparseable.
* @param {number|string} value
* @param {string} prop
* @returns {{n: number, unit: string}|null}
*/
function parseTrackValue(value, prop) {
	const meta = MOTION_PROPS[prop];
	if (!meta) return null;
	if (typeof value === "number") return isFinite(value) ? {
		n: value,
		unit: meta.unit
	} : null;
	if (typeof value !== "string") return null;
	const m = NUMBER_UNIT_RE.exec(value);
	if (!m) return null;
	const n = parseFloat(m[1]);
	if (!isFinite(n)) return null;
	const unit = m[2] || meta.unit;
	if (!meta.units.length) return m[2] ? null : {
		n,
		unit: ""
	};
	return meta.units.indexOf(unit) === -1 ? null : {
		n,
		unit
	};
}
/**
* The number an element's authored TEXT says — a `count` track's REAL
* destination. The inverse of sampleText, so `format` decides how it reads:
* with `decimals`, the LAST separator is the decimal point and every earlier
* one is grouping; without, every separator is grouping.
*
* Why this exists: `to` lives on the shared Animation in project.animations,
* so ONE compiled track serves every binding and every component instance. A
* count bound on a component master therefore ended all four stat cards on the
* master's number (12 / 12 / 12 / 12 instead of 12 / 99 / 11 / 140) while the
* exported HTML held the right numbers — initialStyle never bakes a count, so
* the markup was correct and the first frame overwrote it. The element's own
* text is the only per-instance value there is.
*
* DELIBERATELY STRICT: anything that is not part of a formatted number makes
* this return null, and the authored `track.to` stands. Stripping stray words
* would silently reinterpret "12 months" as 12 and a container's concatenated
* text as whatever digit came first; falling back keeps today's behaviour for
* every text this cannot read with certainty. A text that holds a number the
* track disagrees with is reported instead — see countTargetError.
*
* @param {string} text the element's authored content
* @param {{decimals?: number, group?: boolean, prefix?: string, suffix?: string}} [format]
* @returns {number|null} null when the text holds no readable number
*/
function parseCountText(text, format) {
	if (typeof text !== "string") return null;
	const f = format || {};
	let s = text.trim();
	const prefix = typeof f.prefix === "string" ? f.prefix : "";
	const suffix = typeof f.suffix === "string" ? f.suffix : "";
	if (prefix && s.slice(0, prefix.length) === prefix) s = s.slice(prefix.length);
	if (suffix && suffix.length <= s.length && s.slice(s.length - suffix.length) === suffix) s = s.slice(0, s.length - suffix.length);
	s = s.replace(/−/g, "-").replace(/[\s   ']/g, "");
	if (!s || /[^\d.,-]/.test(s)) return null;
	const cut = (typeof f.decimals === "number" && f.decimals > 0 ? Math.min(20, f.decimals) : 0) > 0 ? Math.max(s.lastIndexOf("."), s.lastIndexOf(",")) : -1;
	s = cut === -1 ? s.replace(/[.,]/g, "") : `${s.slice(0, cut).replace(/[.,]/g, "")}.${s.slice(cut + 1).replace(/[.,]/g, "")}`;
	if (!/^-?(?:\d+|\d*\.\d+)$/.test(s)) return null;
	const n = parseFloat(s);
	return isFinite(n) ? n : null;
}
/**
* The per-element `to` override a compiled timeline needs on an element whose
* text reads `text`: `{count: n}`, or undefined when the timeline holds no
* count or the text holds no number (then the authored `to` stands).
*
* Pass the result as `sampleValues(..., {to})`. Every surface does: the
* published runtime reads the element's textContent once, the canvas and Play
* use the per-instance resolved content they already hold.
*
* @param {{tracks: any[]}} compiled
* @param {string} text
* @returns {Record<string, number>|undefined}
*/
function countToFor(compiled, text) {
	if (!compiled || !compiled.tracks) return void 0;
	let out;
	for (const track of compiled.tracks) {
		const meta = MOTION_PROPS[track.prop];
		if (!meta || meta.kind !== "text") continue;
		const n = parseCountText(text, track.format);
		if (n === null) continue;
		out = out || {};
		out[track.prop] = n;
	}
	return out;
}
var round = (n) => Math.round(n * 1e3) / 1e3;
function parseColor(value) {
	if (typeof value !== "string") return null;
	const hex = value.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
	if (hex.length === 3) return [
		parseInt(hex[0] + hex[0], 16),
		parseInt(hex[1] + hex[1], 16),
		parseInt(hex[2] + hex[2], 16),
		1
	];
	if (hex.length === 6 || hex.length === 8) return [
		parseInt(hex.slice(0, 2), 16),
		parseInt(hex.slice(2, 4), 16),
		parseInt(hex.slice(4, 6), 16),
		hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
	];
	return null;
}
/**
* interpolates two colors, premultiplying nothing — plain channel lerp.
* Falls back to the destination when either side is unparseable.
* @returns {string} an rgba() string
*/
function lerpColor(from, to, t) {
	const a = parseColor(from);
	const b = parseColor(to);
	if (!a || !b) return typeof to === "string" ? to : "";
	const mix = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
	const alpha = a[3] + (b[3] - a[3]) * t;
	return `rgba(${mix(0)}, ${mix(1)}, ${mix(2)}, ${round(alpha)})`;
}
var num = (v, fallback) => typeof v === "number" && isFinite(v) ? v : fallback;
/**
* Flattens an Animation's steps into absolute-timed tracks.
* A step starts at the previous step's END plus its `offset` (negative
* overlaps). `duration` is the timeline length ignoring infinite repeats, so
* scrub mapping stays finite.
*
* @param {{steps?: any[]}} animation
* @returns {{tracks: any[], duration: number}}
*/
function compileAnimation(animation) {
	const tracks = [];
	let cursor = 0;
	let end = 0;
	const steps = animation && animation.steps || [];
	for (let s = 0; s < steps.length; s++) {
		const step = steps[s];
		const duration = Math.max(0, num(step.duration, 0));
		const start = Math.max(0, cursor + num(step.offset, 0));
		const repeat = num(step.repeat, 0);
		const iterations = repeat < 0 ? Infinity : repeat + 1;
		const span = duration * (repeat < 0 ? 1 : iterations);
		const easing = EASINGS[step.easing] ? step.easing : "ease-out";
		const stagger = Math.max(0, num(step.stagger, 0));
		for (const track of step.tracks || []) {
			if (!MOTION_PROPS[track.prop]) continue;
			tracks.push({
				prop: track.prop,
				from: track.from,
				to: track.to,
				format: track.format,
				start,
				duration,
				easing,
				stagger,
				staggerSelector: stagger > 0 ? step.staggerSelector || "" : "",
				repeat: iterations,
				yoyo: !!step.yoyo,
				stepIndex: s
			});
		}
		cursor = start + duration;
		end = Math.max(end, start + span);
	}
	return {
		tracks,
		duration: end
	};
}
function trackProgress(track, t, childIndex) {
	const start = track.start + track.stagger * childIndex;
	if (t < start) return null;
	if (track.duration <= 0) return 1;
	const elapsed = t - start;
	if (elapsed >= track.duration * track.repeat) return track.yoyo && track.repeat !== Infinity && track.repeat % 2 === 0 ? 0 : 1;
	const iteration = Math.floor(elapsed / track.duration);
	const local = elapsed % track.duration / track.duration;
	return track.yoyo && iteration % 2 === 1 ? 1 - local : local;
}
/**
* Samples a compiled animation at time `t` (ms) into per-property VALUES —
* `{n, unit}` for numerics, `{color}` for colors. Keeping values separate from
* CSS lets a caller merge several plays per property before composing, so a
* marquee's x and an entrance's y can share one element.
*
* `current` supplies measured values for tracks that omit `from`.
*
* `to` supplies per-ELEMENT destinations, which is what `current` is for the
* other end of the tween. One compiled timeline serves every binding and every
* component instance, so a `count` — whose destination is the number each
* element already says — has nowhere else to come from (see countToFor).
*
* @param {{tracks: any[], duration: number}} compiled
* @param {number} t
* @param {{childIndex?: number, current?: Record<string, any>, to?: Record<string, number>}} [opts]
* @returns {Record<string, {n?: number, unit?: string, color?: string}>}
*/
function sampleValues(compiled, t, opts) {
	const childIndex = opts && opts.childIndex || 0;
	const current = opts && opts.current || {};
	const override = opts && opts.to || {};
	const values = {};
	for (const track of compiled.tracks) {
		const p = trackProgress(track, t, childIndex);
		if (p === null) continue;
		const meta = MOTION_PROPS[track.prop];
		const eased = EASINGS[track.easing](p);
		if (meta.kind === "color") {
			const from = track.from !== void 0 && track.from !== null ? track.from : current[track.prop] !== void 0 ? current[track.prop] : meta.def;
			values[track.prop] = { color: lerpColor(from, track.to, eased) };
			continue;
		}
		const to = parseTrackValue(override[track.prop] !== void 0 ? override[track.prop] : track.to, track.prop) || {
			n: meta.def,
			unit: meta.unit
		};
		let fromVal;
		if (track.from !== void 0 && track.from !== null) fromVal = parseTrackValue(track.from, track.prop);
		else if (current[track.prop] !== void 0) fromVal = parseTrackValue(current[track.prop], track.prop);
		const fromN = fromVal && fromVal.unit === to.unit ? fromVal.n : fromVal ? fromVal.n : meta.def;
		values[track.prop] = {
			n: fromN + (to.n - fromN) * eased,
			unit: to.unit
		};
		if (meta.kind === "text" && track.format) values[track.prop].format = track.format;
	}
	return values;
}
/**
* The TEXT a `count` track writes at this sample, or undefined when nothing
* counts. Separate from composeMotionStyle because text is not style: the
* caller writes `textContent`, not an inline declaration.
*
* `format` rides on the track (decimals, grouping, prefix, suffix) and reaches
* here through the sampled value, so the exporter, the canvas and the
* published runtime all format identically.
*
* @param {Record<string, any>} values
* @param {string} [locale] BCP-47; the route's language decides the separators
* @returns {string|undefined}
*/
function sampleText(values, locale) {
	const v = values && values.count;
	if (!v || typeof v.n !== "number") return void 0;
	const f = v.format || {};
	const decimals = typeof f.decimals === "number" && f.decimals >= 0 ? Math.min(20, f.decimals) : 0;
	let body;
	try {
		body = new Intl.NumberFormat(locale || void 0, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
			useGrouping: !!f.group
		}).format(v.n);
	} catch {
		body = v.n.toFixed(decimals);
	}
	return `${f.prefix || ""}${body}${f.suffix || ""}`;
}
var TRIGGERS = [
	"load",
	"appear",
	"scrub",
	"mouse",
	"hover",
	"click",
	"scrolled",
	"change"
];
var MOUSE_AXES = ["x", "y"];
var MOUSE_AREAS = ["element", "page"];
var APPEAR_MODES = [
	"once",
	"replay",
	"reverse"
];
var SELECTOR_RE = /^[\w\s.#>~*:+\-[\]="',()]{1,120}$/;
var fail$1 = (error) => ({
	ok: false,
	error
});
/**
* @param {any} animation
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateAnimation(animation) {
	if (!animation || typeof animation !== "object") return fail$1("animation must be an object");
	if (typeof animation.name !== "string" || !animation.name.trim()) return fail$1("animation needs a name");
	if (!Array.isArray(animation.steps) || !animation.steps.length) return fail$1("animation needs at least one step");
	for (let i = 0; i < animation.steps.length; i++) {
		const step = animation.steps[i];
		const at = `step ${i + 1}`;
		if (!step || typeof step !== "object") return fail$1(`${at} must be an object`);
		if (!Array.isArray(step.tracks) || !step.tracks.length) return fail$1(`${at} needs at least one property`);
		if (typeof step.duration !== "number" || !isFinite(step.duration) || step.duration < 0) return fail$1(`${at} duration must be a non-negative number of milliseconds`);
		if (typeof step.easing !== "string" || !EASINGS[step.easing]) return fail$1(`${at} easing must be one of: ${EASING_KEYS.join(", ")}`);
		if (step.repeat !== void 0 && (typeof step.repeat !== "number" || step.repeat < -1)) return fail$1(`${at} repeat must be a number (-1 for infinite)`);
		if (step.stagger !== void 0 && (typeof step.stagger !== "number" || step.stagger < 0)) return fail$1(`${at} stagger must be a non-negative number of milliseconds`);
		if (step.staggerSelector !== void 0) {
			if (typeof step.staggerSelector !== "string" || !SELECTOR_RE.test(step.staggerSelector)) return fail$1(`${at} staggerSelector must be a simple CSS selector (max 120 chars)`);
			if (!step.stagger) return fail$1(`${at} has a staggerSelector but no stagger`);
		}
		for (const track of step.tracks) {
			if (!track || !MOTION_PROPS[track.prop]) return fail$1(`${at} has an unknown property "${track && track.prop}" — use one of: ${Object.keys(MOTION_PROPS).join(", ")}`);
			const meta = MOTION_PROPS[track.prop];
			const hasTo = !(track.to === void 0 || track.to === null || track.to === "");
			if (!hasTo && meta.kind !== "text") return fail$1(`${at} property "${track.prop}" needs a "to" value`);
			if (meta.kind === "color") {
				if (!parseColor(track.to)) return fail$1(`${at} property "${track.prop}" needs a hex color`);
				if (track.from !== void 0 && !parseColor(track.from)) return fail$1(`${at} property "${track.prop}" "from" must be a hex color`);
				continue;
			}
			if (meta.kind === "text") {
				if (step.stagger) return fail$1(`${at} cannot stagger "${track.prop}" — a staggered step moves the children, which have no number to count`);
				if (step.yoyo) return fail$1(`${at} cannot yoyo "${track.prop}" — it would count back down and end on the starting number`);
				if (track.format !== void 0) {
					const f = track.format;
					if (typeof f !== "object" || f === null || Array.isArray(f)) return fail$1(`${at} property "${track.prop}" format must be an object`);
					if (f.decimals !== void 0 && (typeof f.decimals !== "number" || f.decimals < 0 || f.decimals > 20)) return fail$1(`${at} property "${track.prop}" format.decimals must be 0–20`);
					if (f.group !== void 0 && typeof f.group !== "boolean") return fail$1(`${at} property "${track.prop}" format.group must be true or false`);
					for (const k of ["prefix", "suffix"]) if (f[k] !== void 0 && (typeof f[k] !== "string" || f[k].length > 16)) return fail$1(`${at} property "${track.prop}" format.${k} must be a string of at most 16 characters`);
					for (const k of Object.keys(f)) if ([
						"decimals",
						"group",
						"prefix",
						"suffix"
					].indexOf(k) === -1) return fail$1(`${at} property "${track.prop}" format has an unknown key "${k}"`);
				}
			}
			const units = meta.units.length ? ` (units: ${meta.units.join(", ")})` : " (no unit)";
			const to = hasTo ? parseTrackValue(track.to, track.prop) : {
				n: meta.def,
				unit: meta.unit
			};
			if (!to) return fail$1(`${at} property "${track.prop}" has an invalid "to" value${units}`);
			if (track.from !== void 0 && track.from !== null) {
				const from = parseTrackValue(track.from, track.prop);
				if (!from) return fail$1(`${at} property "${track.prop}" has an invalid "from" value${units}`);
				if (typeof track.from === "string" && typeof track.to === "string" && from.unit !== to.unit) return fail$1(`${at} property "${track.prop}" mixes units ("${from.unit}" → "${to.unit}") — use the same unit on both sides`);
			}
		}
	}
	return { ok: true };
}
function animationWritesText(animation) {
	for (const step of animation && animation.steps || []) for (const track of step.tracks || []) {
		const meta = MOTION_PROPS[track && track.prop];
		if (meta && meta.kind === "text") return true;
	}
	return false;
}
/**
* Where a `count` may land: a LEAF that carries text, not one whose text comes
* from a collection field, and — when it already says something — a text the
* track can actually read back.
*
* A container has no text of its own to replace — the write would wipe its
* children — and a field-bound element re-renders from the entry, so the two
* would fight. Checked at every bind site rather than at play time, because a
* binding that quietly does nothing is the bug class this whole layer exists
* to stop.
*
* The third check is the `format` one. The element's own text is the
* destination (parseCountText → sampleValues `to`), so a `format` that cannot
* read that text back silently falls through to the authored `track.to` and the
* number lands on something the author never wrote. Comparing the rendered END
* STATE with the authored text catches both halves of that in one go: a format
* that does not round-trip, and a text that holds no number at all. Skipped
* when the element has no text yet, because binding before writing the copy is
* an ordinary order of work.
*
* @param {any} animation the library timeline being bound
* @param {{type?: string, isLeaf?: boolean, isBound?: boolean, text?: string,
*   locale?: string}|null} target the element the animation MOVES (the
*   binding's target, not its trigger)
* @returns {string|null} the refusal, or null
*/
function countTargetError(animation, target) {
	if (!animationWritesText(animation)) return null;
	if (!target) return null;
	if (!target.isLeaf) return `a 'count' track writes the element's TEXT, and '${target.type || "this element"}' is a container — bind it to a leaf that carries words (a span, a heading, a paragraph)`;
	if (target.isBound) return "a 'count' track writes the element's TEXT, but this element's text comes from a collection field — the two would fight. Count a plain element beside it.";
	const text = typeof target.text === "string" ? target.text.trim() : "";
	if (text) {
		const compiled = compileAnimation(animation);
		const end = sampleText(sampleValues(compiled, compiled.duration, { to: countToFor(compiled, text) }), target.locale || void 0);
		const norm = (s) => s.replace(/−/g, "-").replace(/[\s   ]/g, "");
		if (end !== void 0 && norm(end) !== norm(text)) return `a 'count' track would end on "${end}", but this element says "${text}" — the element's own text is what it counts up to, so make the track's "to" and "format" (decimals, group, prefix, suffix) read "${text}" back, or fix the text`;
	}
	return null;
}
/**
* @param {any} binding
* @param {{animationIds?: string[]}} [ctx]
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateBinding(binding, ctx) {
	if (!binding || typeof binding !== "object") return fail$1("binding must be an object");
	if (typeof binding.animationId !== "string" || !binding.animationId) return fail$1("binding needs an animationId");
	const known = ctx && ctx.animationIds;
	if (known && known.indexOf(binding.animationId) === -1) return fail$1(`no animation "${binding.animationId}" in the library`);
	if (TRIGGERS.indexOf(binding.trigger) === -1) return fail$1(`trigger must be one of: ${TRIGGERS.join(", ")}`);
	if (binding.scrollAt !== void 0) {
		if (binding.trigger !== "scrolled") return fail$1("scrollAt only applies to the 'scrolled' trigger");
		if (typeof binding.scrollAt !== "number" || binding.scrollAt < 0) return fail$1("scrollAt must be a number of pixels");
	}
	if (binding.appearMode !== void 0 && APPEAR_MODES.indexOf(binding.appearMode) === -1) return fail$1(`appearMode must be one of: ${APPEAR_MODES.join(", ")}`);
	if (binding.action !== void 0) {
		if (ANIMATION_ACTIONS.indexOf(binding.action) === -1) return fail$1(`action must be one of: ${ANIMATION_ACTIONS.join(", ")}`);
		if (binding.action !== "toggle" && binding.trigger !== "click") return fail$1(`action is only meaningful on a click trigger ('${binding.trigger}' has no state to aim at)`);
	}
	if (binding.appearAt !== void 0) {
		if (typeof binding.appearAt !== "number" || binding.appearAt < 0 || binding.appearAt > 1) return fail$1("appearAt must be a number between 0 and 1 (viewport fraction)");
	}
	if (binding.delay !== void 0) {
		if (typeof binding.delay !== "number" || !isFinite(binding.delay) || binding.delay < 0 || Math.floor(binding.delay) !== binding.delay) return fail$1("delay must be a whole number of milliseconds (0 or more)");
		if (binding.trigger === "scrub") return fail$1("delay does not apply to a 'scrub' binding — it follows the scroll, nothing fires it");
		if (binding.trigger === "mouse") return fail$1("delay does not apply to a 'mouse' binding — it follows the pointer, nothing fires it");
	}
	if (binding.scrub !== void 0) {
		if (typeof binding.scrub !== "object" || binding.scrub === null) return fail$1("scrub must be an object with start/end");
		for (const k of ["start", "end"]) {
			const v = binding.scrub[k];
			if (v !== void 0 && (typeof v !== "number" || !isFinite(v))) return fail$1(`scrub.${k} must be a number`);
		}
		const smooth = binding.scrub.smooth;
		if (smooth !== void 0 && (typeof smooth !== "number" || !isFinite(smooth) || smooth < 0 || smooth > 3)) return fail$1("scrub.smooth must be a number of seconds between 0 and 3");
	}
	if (binding.mouse !== void 0) {
		if (typeof binding.mouse !== "object" || binding.mouse === null) return fail$1("mouse must be an object with axis/area/smooth");
		if (binding.trigger !== "mouse") return fail$1("mouse only applies to the 'mouse' trigger");
		const { axis, area, smooth } = binding.mouse;
		if (axis !== void 0 && MOUSE_AXES.indexOf(axis) === -1) return fail$1(`mouse.axis must be one of: ${MOUSE_AXES.join(", ")}`);
		if (area !== void 0 && MOUSE_AREAS.indexOf(area) === -1) return fail$1(`mouse.area must be one of: ${MOUSE_AREAS.join(", ")}`);
		if (smooth !== void 0 && (typeof smooth !== "number" || !isFinite(smooth) || smooth < 0 || smooth > 3)) return fail$1("mouse.smooth must be a number of seconds between 0 and 3");
	}
	return { ok: true };
}
var TRANSITION_DEFAULTS = {
	preset: "fade",
	duration: 500,
	easing: "ease-out",
	exitRatio: .75,
	exitTimeoutMs: 1500,
	maxDuration: 5e3
};
var TRANSITION_PRESETS = {
	fade: {
		label: "Fade",
		exit: [{
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-up": {
		label: "Slide up",
		exit: [{
			prop: "y",
			from: 0,
			to: -32
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "y",
			from: 32,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-down": {
		label: "Slide down",
		exit: [{
			prop: "y",
			from: 0,
			to: 32
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "y",
			from: -32,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-left": {
		label: "Slide left",
		exit: [{
			prop: "x",
			from: 0,
			to: -48
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "x",
			from: 48,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	"slide-right": {
		label: "Slide right",
		exit: [{
			prop: "x",
			from: 0,
			to: 48
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "x",
			from: -48,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	zoom: {
		label: "Zoom",
		exit: [{
			prop: "scale",
			from: 1,
			to: .97
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "scale",
			from: 1.03,
			to: 1
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	},
	blur: {
		label: "Blur",
		exit: [{
			prop: "blur",
			from: 0,
			to: 8
		}, {
			prop: "opacity",
			from: 1,
			to: 0
		}],
		enter: [{
			prop: "blur",
			from: 8,
			to: 0
		}, {
			prop: "opacity",
			from: 0,
			to: 1
		}]
	}
};
var TRANSITION_PRESET_IDS = Object.keys(TRANSITION_PRESETS);
var SCROLL_LERP_MIN = .02;
var SCROLL_LERP_MAX = .4;
/**
* @param {any} motion — a candidate settings.motion
* @param {{animationIds?: string[]}} [ctx]
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateMotionSettings(motion, ctx) {
	if (motion === void 0 || motion === null) return { ok: true };
	if (typeof motion !== "object" || Array.isArray(motion)) return fail$1("motion must be an object");
	if (motion.appearMode !== void 0 && APPEAR_MODES.indexOf(motion.appearMode) === -1) return fail$1(`motion.appearMode must be one of: ${APPEAR_MODES.join(", ")}`);
	const t = motion.transitions;
	if (t !== void 0 && t !== null) {
		if (typeof t !== "object" || Array.isArray(t)) return fail$1("motion.transitions must be an object");
		if (typeof t.enabled !== "boolean") return fail$1("motion.transitions.enabled must be a boolean");
		if (t.preset !== void 0 && t.preset !== "custom" && !TRANSITION_PRESETS[t.preset]) return fail$1(`motion.transitions.preset must be "custom" or one of: ${TRANSITION_PRESET_IDS.join(", ")}`);
		if (t.duration !== void 0 && (typeof t.duration !== "number" || !isFinite(t.duration) || t.duration < 0 || t.duration > TRANSITION_DEFAULTS.maxDuration)) return fail$1(`motion.transitions.duration must be between 0 and ${TRANSITION_DEFAULTS.maxDuration} ms`);
		if (t.easing !== void 0 && !EASINGS[t.easing]) return fail$1(`motion.transitions.easing must be one of: ${EASING_KEYS.join(", ")}`);
		const known = ctx && ctx.animationIds;
		for (const key of ["exitAnimationId", "enterAnimationId"]) {
			const id = t[key];
			if (id === void 0 || id === null) continue;
			if (typeof id !== "string" || !id) return fail$1(`motion.transitions.${key} must be an animation id`);
			if (known && known.indexOf(id) === -1) return fail$1(`no animation "${id}" in the library`);
		}
	}
	const s = motion.scroll;
	if (s !== void 0 && s !== null) {
		if (typeof s !== "object" || Array.isArray(s)) return fail$1("motion.scroll must be an object");
		if (typeof s.enabled !== "boolean") return fail$1("motion.scroll.enabled must be a boolean");
		if (s.lerp !== void 0 && (typeof s.lerp !== "number" || !isFinite(s.lerp) || s.lerp < .02 || s.lerp > .4)) return fail$1(`motion.scroll.lerp must be between ${SCROLL_LERP_MIN} and ${SCROLL_LERP_MAX}`);
	}
	return { ok: true };
}
//#endregion
//#region src/lib/shared/slider.js
var PER_VIEW_MIN = 1;
var PER_VIEW_MAX = 8;
var GAP_MAX = 500;
var DELAY_MIN = 500;
var DELAY_MAX = 6e4;
var SLIDER_DEFAULTS = {
	arrows: true,
	dots: true,
	gap: 0,
	autoplay: false,
	delay: 4e3,
	loop: false,
	drag: true
};
var PER_VIEW_BASE = "base";
var SLIDER_KEYS = [
	"arrows",
	"dots",
	"perView",
	"gap",
	"autoplay",
	"delay",
	"loop",
	"drag"
];
var fail = (error) => ({
	ok: false,
	error
});
var isBool = (v) => typeof v === "boolean";
var isNum = (v) => typeof v === "number" && isFinite(v);
/**
* @param {any} config
* @param {{breakpointIds?: string[]}} [ctx] when given, perView keys are checked
*   against the project's real breakpoints (the MCP path — the editor only ever
*   writes keys it just read off the project)
* @returns {{ok: true} | {ok: false, error: string}}
*/
function validateSliderConfig(config, ctx = {}) {
	if (!config || typeof config !== "object" || Array.isArray(config)) return fail("slider must be an object");
	for (const key of Object.keys(config)) if (!SLIDER_KEYS.includes(key)) return fail(`unknown slider option '${key}' — use one of: ${SLIDER_KEYS.join(", ")}`);
	for (const key of [
		"arrows",
		"dots",
		"autoplay",
		"loop",
		"drag"
	]) if (config[key] !== void 0 && !isBool(config[key])) return fail(`slider ${key} must be true or false`);
	if (config.gap !== void 0 && (!isNum(config.gap) || config.gap < 0 || config.gap > GAP_MAX)) return fail(`slider gap must be a number of pixels between 0 and ${GAP_MAX}`);
	if (config.delay !== void 0 && (!isNum(config.delay) || config.delay < DELAY_MIN || config.delay > DELAY_MAX)) return fail(`slider delay must be a number of milliseconds between ${DELAY_MIN} and ${DELAY_MAX}`);
	if (config.perView !== void 0) {
		const pv = config.perView;
		if (!pv || typeof pv !== "object" || Array.isArray(pv)) return fail(`slider perView must be an object keyed by '${PER_VIEW_BASE}' and breakpoint ids`);
		for (const [key, value] of Object.entries(pv)) {
			if (key !== "base" && ctx.breakpointIds && !ctx.breakpointIds.includes(key)) return fail(`slider perView key '${key}' is not a breakpoint — use '${PER_VIEW_BASE}'` + (ctx.breakpointIds.length ? ` or one of: ${ctx.breakpointIds.join(", ")}` : ""));
			if (!isNum(value) || !Number.isInteger(value) || value < PER_VIEW_MIN || value > PER_VIEW_MAX) return fail(`slider perView '${key}' must be a whole number of slides between ${PER_VIEW_MIN} and ${PER_VIEW_MAX}`);
		}
	}
	return { ok: true };
}
/**
* A fully-defaulted config. Deliberately TOLERANT where the validator is
* strict: a perView key for a breakpoint the user has since deleted is dropped
* rather than failing, so a stale config never breaks a render.
*
* @param {any} config node.slider, possibly undefined
* @param {{id: string, width: number}[]} [breakpoints] project.breakpoints
*/
function resolveSliderConfig(config, breakpoints = []) {
	const c = config && typeof config === "object" ? config : {};
	const known = new Set(breakpoints.map((b) => b.id));
	const perView = {};
	for (const [key, value] of Object.entries(c.perView ?? {})) {
		if (key !== "base" && !known.has(key)) continue;
		if (!isNum(value)) continue;
		perView[key] = Math.min(PER_VIEW_MAX, Math.max(PER_VIEW_MIN, Math.round(value)));
	}
	return {
		arrows: isBool(c.arrows) ? c.arrows : SLIDER_DEFAULTS.arrows,
		dots: isBool(c.dots) ? c.dots : SLIDER_DEFAULTS.dots,
		gap: isNum(c.gap) ? Math.max(0, Math.min(GAP_MAX, c.gap)) : SLIDER_DEFAULTS.gap,
		autoplay: isBool(c.autoplay) ? c.autoplay : SLIDER_DEFAULTS.autoplay,
		delay: isNum(c.delay) ? Math.max(DELAY_MIN, Math.min(DELAY_MAX, c.delay)) : SLIDER_DEFAULTS.delay,
		loop: isBool(c.loop) ? c.loop : SLIDER_DEFAULTS.loop,
		drag: isBool(c.drag) ? c.drag : SLIDER_DEFAULTS.drag,
		perView
	};
}
var SLIDER_DOT_BASE = "size-2 rounded-full bg-current transition-opacity";
`${SLIDER_DOT_BASE}`;
`${SLIDER_DOT_BASE}`;
var SLIDER_LABELS = {
	prev: "Previous slide",
	next: "Next slide",
	dots: "Slides",
	dot: "Go to slide {n}"
};
var SLIDER_LABEL_ATTRS = {
	"data-prev-label": "prev",
	"data-next-label": "next",
	"data-dots-label": "dots",
	"data-dot-label": "dot"
};
/**
* The chrome's words for this slider: authored attributes over the defaults.
* @param {Record<string,string>} [attributes] the node's RESOLVED attributes
*   (layered master → placement → locale), i.e. what the renderer would emit
* @returns {{prev: string, next: string, dots: string, dot: string}}
*/
function resolveSliderLabels(attributes) {
	const out = { ...SLIDER_LABELS };
	for (const name of Object.keys(SLIDER_LABEL_ATTRS)) {
		const value = attributes ? attributes[name] : void 0;
		if (typeof value === "string" && value.trim()) out[SLIDER_LABEL_ATTRS[name]] = value;
	}
	return out;
}
/**
* The resolved labels back as attribute names — what the translation worklist
* lists, so an unauthored slider still offers its four English defaults to
* translate instead of being silently absent.
* @param {Record<string,string>} [attributes]
* @param {{arrows?: boolean, dots?: boolean}} [config] only the chrome that renders
*/
function sliderLabelAttributes(attributes, config) {
	const labels = resolveSliderLabels(attributes);
	const out = {};
	for (const name of Object.keys(SLIDER_LABEL_ATTRS)) {
		const key = SLIDER_LABEL_ATTRS[name];
		if (config) {
			if ((key === "prev" || key === "next") && !config.arrows) continue;
			if ((key === "dots" || key === "dot") && !config.dots) continue;
		}
		out[name] = labels[key];
	}
	return out;
}
//#endregion
//#region src/lib/collectionFields.ts
var isTranslatableType = (t) => t === "text";
var RESERVED_FIELD_NAMES = ["name", "slug"];
function fieldNameError(name) {
	const trimmed = String(name ?? "").trim();
	if (!trimmed) return "a field needs a name";
	if (RESERVED_FIELD_NAMES.includes(trimmed.toLowerCase())) return `"${trimmed}" is an entry's OWN property (${RESERVED_FIELD_NAMES.join(", ")}), set at the top level of an upsert_entries item — a FIELD by that name would be a second value with the same name, and every route and @item link would use the other one. Pick another name`;
	return null;
}
function fieldValueError(field, value) {
	if (value === "") return null;
	if (field.type === "number") return Number.isFinite(Number(value)) ? null : `"${value}" is not a number`;
	if (field.type === "boolean") return value === "true" || value === "false" ? null : `"${value}" is not "true" or "false"`;
	if (field.type === "select") {
		const options = field.options ?? [];
		if (!options.length) return `"${field.name}" has no options yet — add them to the field first`;
		return options.includes(value) ? null : `"${value}" is not one of ${options.map((o) => `"${o}"`).join(", ")}`;
	}
	return null;
}
//#endregion
//#region src/lib/shared/channels.js
function walk(nodes, visit) {
	for (const node of nodes ?? []) {
		visit(node);
		walk(node.children, visit);
	}
}
/**
* Every binding in the project that targets a channel, grouped by channel name.
*
* @param {{pages?: any[], components?: any[]}} project
* @returns {Map<string, {interactions: {binding: any, ownerId: string, inMaster: boolean}[],
*                        animations:  {binding: any, ownerId: string, inMaster: boolean}[]}>}
*/
function buildChannelIndex(project) {
	const index = /* @__PURE__ */ new Map();
	const at = (name) => {
		let entry = index.get(name);
		if (!entry) index.set(name, entry = {
			interactions: [],
			animations: []
		});
		return entry;
	};
	const collect = (owner, inMaster) => {
		for (const binding of owner.interactions ?? []) {
			const name = channelName(binding.targetId);
			if (name) at(name).interactions.push({
				binding,
				ownerId: owner.id,
				inMaster
			});
		}
		for (const binding of owner.animations ?? []) {
			const name = channelName(binding.targetId);
			if (name) at(name).animations.push({
				binding,
				ownerId: owner.id,
				inMaster
			});
		}
	};
	for (const page of project.pages ?? []) walk(page.elements, (n) => collect(n, false));
	for (const component of project.components ?? []) walk([component.root], (n) => collect(n, true));
	return index;
}
/**
* Every element that DECLARES a channel, grouped by name. A listener may live
* on a page (the modal placed once per page) or on a component master (the
* modal IS a component, which is the case worth having) — see
* `channel-declared-twice` for the one thing that goes wrong.
*
* @param {{pages?: any[], components?: any[]}} project
* @returns {Map<string, {nodeId: string, pageId?: string, pageName?: string,
*                        componentId?: string, componentName?: string}[]>}
*/
function channelListeners(project) {
	const index = /* @__PURE__ */ new Map();
	const add = (node, where) => {
		if (!isChannelName(node.channel)) return;
		const list = index.get(node.channel) ?? [];
		list.push({
			nodeId: node.id,
			...where
		});
		index.set(node.channel, list);
	};
	for (const page of project.pages ?? []) walk(page.elements, (n) => add(n, {
		pageId: page.id,
		pageName: page.name
	}));
	for (const component of project.components ?? []) walk([component.root], (n) => add(n, {
		componentId: component.id,
		componentName: component.name
	}));
	return index;
}
/**
* How many times each channel is DECLARED on one route — a component master's
* declaration counts once per instance the route holds, which is exactly the
* mistake `channel-declared-twice` names. Two listeners on one channel both
* open, so the page shows the overlay twice.
*
* @param {any[][]} trees the node lists the route renders (the page's, plus
*   any template bodies a `collection-item` embeds)
* @param {Map<string, {master: any}>} instanceMap the route's instance map —
*   a mapped node listens on what its MASTER declares, since a channel is
*   shared state like classes
* @returns {Map<string, number>}
*/
function routeChannelCounts(trees, instanceMap) {
	const counts = /* @__PURE__ */ new Map();
	for (const tree of trees) walk(tree, (node) => {
		const rendered = instanceMap?.get(node.id)?.master ?? node;
		if (!isChannelName(rendered.channel)) return;
		counts.set(rendered.channel, (counts.get(rendered.channel) ?? 0) + 1);
	});
	return counts;
}
//#endregion
export { APPEAR_MODES, BUILTIN_LIST_SOURCES, CHANNEL_NAME_RE, DEFAULT_SCROLL_AT, EASINGS, EASING_KEYS, ELEMENTS, ELIDED_DATA_URL, FONT_FORMATS, HEX_RE, INTERACTION_ACTIONS, INTERACTION_CLOSE_ON, INTERACTION_ONCE, INTERACTION_TRIGGERS, MAX_DEPTH, MAX_INPUT, MAX_SVG_BYTES, MOTION_PROPS, RESERVED_FIELD_NAMES, RESERVED_TOKEN_NAMES, SAFE_HREF, SAFE_SRC, SCHEMA_VERSION, SCROLL_LERP_MAX, SCROLL_LERP_MIN, SLIDER_DEFAULTS, STYLE_SECTIONS, TOKEN_NAME_RE, TRANSITION_DEFAULTS, TRANSITION_PRESET_IDS, VARIANT_NAME_RE, addVariantAxis, addVariantOption, adoptStructure, alignMirrors, alignStructure, applyClass, applyHtml, buildChannelIndex, buildInstanceMap, buildScopeRoots, canNest, channelListeners, channelName, channelTargetId, cloneForMaster, collectFormFields, collectionRouteBase, compileAnimation, componentReaches, componentUsage, contextFromProject, countLocaleSeo, countTargetError, createBody, createNode, createPage, createProject, customSchemaError, deepClone, defaultBreakpoints, defaultSettings, deleteComponent, dependencyOrder, describeMigration, detachInstance, duplicateComponent, effectiveClasses, entryRoutePath, fieldNameError, fieldValueError, findNode, findParent, fontError, fontFormatForUrl, formConfigError, formEnabled, formName, hasAncestorOfType, hasDetailRoutes, inheritedInstanceValue, interactionGroupKey, interactionStateKey, isAllowedAttribute, isChannelName, isChannelTarget, isComponentType, isEmittableToken, isEntryScopeRoot, isInstancePart, isInstanceWrapper, isKnownElement, isLeafElement, isLocalizableAttribute, isNodeHidden, isReservedToken, isRich, isStateClass, isSymmetricTrigger, isThemeValue, isTranslatableType, isValidClass, isValidToken, lucideNameOf, lucideSvg, masterToHtml, matchClass, mergeAttributeLayers, mergeClassLayers, migrateProject, nestedComponentNames, nodesByShortId, normalizeComponentName, pageToHtml, parseHtml, pickedKeys, purgeLocaleSeo, pushMasterStructure, removeVariantAxis, removeVariantOption, renameComponent, renameVariantAxis, renameVariantOption, resolveInstanceValue, resolveNodeAttributes, resolvePicks, resolveSliderConfig, routeChannelCounts, sameLayerProperty, sameProperty, sameType, sanitizeAttributes, sanitizeInlineSvg, sanitizeRich, setComponentCategory, setComponentMeta, setInstancePick, setNodeHidden, setStyleTokens, setVariantAxes, setVariantClasses, setVariantDefault, shortIds, sliderLabelAttributes, slugify, stripExtractedInstanceState, tagForType, tokenError, typeForTag, typeOptionsFor, validateAnimation, validateBinding, validateMotionSettings, validateSliderConfig, validateTree, variantKey, walkNodes };
