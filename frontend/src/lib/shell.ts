// Single-quote-escape a string so it can be safely pasted as a shell argument.
// Used by the "cd into folder" sidebar action and the file-tree drag-drop
// drop handler (which writes a path into the active terminal's PTY).
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
