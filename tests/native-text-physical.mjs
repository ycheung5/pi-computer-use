// Retired physical-text runner: preserve its public plan/refusal contract.
// The old fixture overwrote the clipboard and could retire unsettled input.
// Preserve refusal for callers of the retired command, regardless of flags.
if (process.argv.length === 3 && process.argv[2] === "--plan") {
  console.log(
    JSON.stringify({
      executed: false,
      blocked: true,
      reason: "clipboard-and-input-settlement-unverified",
    }),
  );
  process.exit(0);
}
function requireSafeFixture() {
  throw new Error(
    "LEGACY_TEXT_PHYSICAL_UNSAFE: original clipboard restoration and input settlement are unverified; use documented preservation-aware fixtures",
  );
}
requireSafeFixture();
