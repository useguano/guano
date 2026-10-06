# create-guano

Scaffold a new [Guano](https://www.npmjs.com/package/guano) site project.

```sh
npm create guano
```

Asks for a folder name (default `my-site`), creates it with `guano` as a
dependency plus `dev`/`start`/`build` scripts, a `.env.example` and a
`.gitignore`, and runs `npm install`. Then:

```sh
cd my-site
npm run dev
```

Open `http://localhost:4174/admin` and create the first account. Pass the
folder as an argument to skip the prompt (`npm create guano my-site`), and
`--no-install` to skip the install step.
