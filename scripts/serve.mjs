import { networkInterfaces } from "node:os";
import { startStaticServer } from "./server.mjs";

const root = process.cwd();
const port = Number(process.env.PORT) || 8080;
const lan = process.argv.includes("--lan");

// First non-internal IPv4 address, i.e. the one other devices on the LAN reach.
function findLanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

const lanAddress = lan ? findLanAddress() : null;
if (lan && !lanAddress) {
  console.error("No LAN IPv4 address found; is this host on a network?");
  process.exit(1);
}

// In LAN mode bind every interface but advertise the LAN address.
const { url } = await startStaticServer({
  root,
  port,
  host: lan ? "0.0.0.0" : undefined,
});
const base = lan ? url.replace("0.0.0.0", lanAddress) : url;

console.log(`Serving ${root}`);
console.log(`  Root:   ${base}/`);
console.log(`  Wizard: ${base}/wizard/`);
console.log(`  Webapp: ${base}/webapp/`);
if (lan) {
  console.log(
    "\nLAN mode: reachable by other devices on this network (plain http).",
  );
}
console.log("\nPress Ctrl+C to stop.");
