/*
 * What goes into the downloadable web app bundle, for people who want to host their
 * own copy (for example on an internal IIS server). Free of DOM access so the unit
 * tests can import it directly.
 */

// Files fetched from ../webapp/ next to the wizard. __tests__/wizard/webapp-bundle
// checks this covers everything webapp/index.html loads from its own folder.
export const BUNDLE_FILES = [
  "index.html",
  "app-config.js",
  "view-mode.js",
  "calendar.js",
  "framing.js",
  "demo.js",
];

// The page's icon lives in the wizard folder, so the bundle carries its own copy.
export const BUNDLE_FAVICON = {
  from: "../wizard/favicon.svg",
  name: "favicon.svg",
};

/** Point the page at the bundled favicon instead of ../wizard/favicon.svg. */
export function rewriteIndex(html) {
  return html.replace(
    `href="${BUNDLE_FAVICON.from}"`,
    `href="${BUNDLE_FAVICON.name}"`,
  );
}

/** Plain-text instructions included in the zip. */
export function bundleReadme({
  title = "MTR Controller PWA",
  hostUrl = "",
} = {}) {
  return [
    `${title} - web app bundle`,
    "",
    "A static copy of the web app. There is no server side code: any web server that",
    "can serve files over HTTPS will do (IIS, nginx, Apache, ...).",
    "",
    "Host it on Microsoft IIS:",
    "  1. Unzip this bundle into a folder on the server, e.g. C:\\inetpub\\wwwroot\\mtr-controller-pwa",
    "  2. In IIS Manager add a website, or a virtual directory / application under an existing",
    "     site, whose physical path is that folder.",
    "  3. Make sure the site has an HTTPS binding the Room Navigator trusts.",
    '  4. Browse to the site. Seeing "No parameters found in the URL hash" is correct: the',
    "     macro supplies the parameters.",
    "  5. In the configuration wizard set the Web app URL to your site",
    hostUrl
      ? `     (${hostUrl}),`
      : "     (e.g. https://pwa.example.com/mtr-controller-pwa/),",
    "     export the macro again and load it on the MTR device. The macro keeps updating",
    "     the URL hash (account, IP address, mode) from then on.",
    "",
    "The page still loads jsxapi and the Momentum icons and theme from public CDNs.",
    "Navigators on a network without internet access need those files hosted too; update",
    "the links near the top of index.html.",
    "",
  ].join("\n");
}
