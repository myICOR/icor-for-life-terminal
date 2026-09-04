# Third-party notices

The built `main.js` and the assembled `styles.css` bundle the following
third-party components. Every one is MIT licensed; the licence text is the
same for all of them and is reproduced once at the end.

## @xterm/xterm

- Version: 6.0.0
- Copyright (c) 2017-2019, The xterm.js authors (MIT). Copyright (c) 2014-2016, SourceLair Private Company (MIT). Copyright (c) 2012-2013, Christopher Jeffrey (MIT).
- Used for: the terminal emulator, rendering and input. Its `css/xterm.css`
  is included verbatim in section 1 of `styles.css` with its licence header,
  after the six mechanical rewrites listed in `esbuild.config.mjs`
  (`transformUpstreamCss`) that remove declarations the Obsidian directory's
  CSS scanner rejects.

## @xterm/addon-fit

- Version: 0.11.0, The xterm.js authors (MIT).
- Used for: sizing the grid to the pane.

## @xterm/addon-search

- Version: 0.16.0, The xterm.js authors (MIT).
- Used for: the find bar.

## @xterm/addon-web-links

- Version: 0.12.0, The xterm.js authors (MIT).
- Used for: clickable URLs in output.

## @xterm/addon-unicode11

- Version: 0.9.0, The xterm.js authors (MIT).
- Used for: correct width of Unicode 11 characters, including emoji.

## @xterm/addon-webgl

- Version: 0.19.0, The xterm.js authors (MIT).
- Used for: the WebGL renderer where the graphics stack allows it. When it
  cannot start, xterm's built-in DOM renderer draws the terminal.

## Python standard library

The pseudo-terminal helper (`src/pty/helper.py`, shipped inside `main.js` as
a string) uses only the Python 3 standard library (`os`, `pty`, `select`,
`fcntl`, `termios`, `struct`, `signal`). Python itself is not bundled; the
plugin runs the `python3` already installed on the machine.

## Icons

Lucide icon names are resolved through Obsidian's own `setIcon` API at
runtime. No icon assets are bundled.

Everything else in this plugin is written for it. No code is inherited from
any other terminal plugin; the design of the Python helper follows the same
approach the community has used for years (a `pty.fork()` proxy with a
side channel for resizes), written independently from that description.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
