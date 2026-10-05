// Stand-in for optional libraries that jsPDF can load but FontCraft never uses
// (html2canvas, canvg, dompurify: only needed for doc.html() and SVG images). Aliased in vite.config.ts so they
// are not bundled, which keeps the offline precache small.
const unavailable = (): never => {
  throw new Error('This optional PDF feature is not included in FontCraft.');
};
export default unavailable;
export const html2canvas = unavailable;
export const sanitize = unavailable;
