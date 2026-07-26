# Next architecture (deferred)

The known better long term design is to render the resume as HTML and CSS and
produce the PDF with Electron's own Chromium via `webContents.printToPDF`. That
removes tectonic, the network dependency it carries, and the compile then count
then trim loop entirely, and it turns one page fitting into a direct DOM
measurement instead of a compile and re-measure cycle.

Deferred. Not for this season. This note only records the direction; nothing in
the current pipeline should be changed toward it yet.
