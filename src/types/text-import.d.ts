/* The pty helper is Python source shipped INSIDE main.js as a string: esbuild's
 * text loader turns the .py file into a module whose default export is its
 * contents. Nothing in the bundle evaluates it; the string is handed to
 * `python3 -c` at spawn time, which is the one place it runs. */
declare module '*.py' {
  const source: string;
  export default source;
}
