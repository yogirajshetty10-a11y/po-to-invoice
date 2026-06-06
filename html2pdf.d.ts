declare module "html2pdf.js" {
  // Minimal typing: html2pdf() returns a chainable worker. We only use
  // .set(opts).from(element).save(), so keep it loose.
  const html2pdf: () => any;
  export default html2pdf;
}
