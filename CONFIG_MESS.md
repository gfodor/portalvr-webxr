# Configuration System Sprawl

## The Problem

The PortalVR configuration system has three separate, nearly-identical implementations that must be kept manually in sync:

1. **`src/device/PortalEmulatorConfig.ts`** - The "main" config used by the core library
2. **`src/context/shared.ts`** - Used by the context bridge for standalone/iframe modes
3. **`immersive-web-emulator/src/service-worker.ts`** - Used by the Chrome extension's service worker

Each file contains its own copy of:
- `PortalEmulatorConfig` interface
- `DEFAULT_CONFIG` constant
- `ensureConfigDefaults()` function
- `normalizeConfig()` function
- Various helper functions (`normalizeCameraDragHand`, `normalizePlayerHeight`, etc.)

## Why This Happened

The duplication exists because:

1. **Bundle isolation**: The Chrome extension service worker runs in an isolated context and can't import from the main library bundle
2. **Context bridge isolation**: The `shared.ts` context bridge code needs to work in content script contexts that may have different bundling requirements
3. **Historical accumulation**: Settings were added incrementally, and each addition required updating all three files

## Current Pain Points

- Adding a new setting requires changes to 3+ files
- Easy to miss one location (as happened with `snapbackEnabled`)
- No compile-time guarantee that the interfaces stay in sync
- Code review burden to verify all locations are updated

## Potential Solutions

### Option 1: Shared Types Package

Create a separate `@portalvr/config-types` package that exports only types and constants:

```
packages/
  config-types/
    src/
      index.ts        # Types only, no runtime code
      defaults.ts     # Default values as plain objects
```

Pros:
- Types stay in sync via imports
- Service worker can import types without runtime overhead

Cons:
- Doesn't solve the normalization logic duplication
- Adds package management complexity

### Option 2: Code Generation

Write a single source-of-truth config schema (JSON Schema or TypeScript) and generate the three implementations:

```
scripts/
  generate-config.ts   # Reads schema, outputs to all three locations
config/
  schema.ts            # Single source of truth
```

Pros:
- Single source of truth
- Could generate validation logic too

Cons:
- Build step complexity
- Generated code can be harder to debug

### Option 3: Runtime Shared Module

Restructure so that `shared.ts` becomes the single implementation, and both the main library and service worker import from it:

```
src/
  config/
    schema.ts           # Types and defaults
    normalize.ts        # All normalization logic
    storage.ts          # Storage-specific code (localStorage, chrome.storage)
```

The service worker would need to be bundled differently to include this shared code.

Pros:
- True single source of truth
- No code generation

Cons:
- Requires reworking the service worker build
- May increase service worker bundle size

### Option 4: Minimal Sync with Lint Rule

Keep the duplication but add safeguards:

1. Add a custom ESLint rule or test that verifies all three `PortalEmulatorConfig` interfaces have the same keys
2. Add a pre-commit hook that warns when one file is modified without the others
3. Document the pattern clearly (this file)

Pros:
- Minimal change to existing architecture
- Catches drift automatically

Cons:
- Doesn't reduce duplication
- Still requires manual updates

## Recommended Approach

**Short term**: Option 4 - Add a test that compares the interfaces across files and fails if they diverge.

**Long term**: Option 3 - Restructure to have a single shared config module. This requires:

1. Move all config logic to `src/config/`
2. Update the service worker build to bundle this shared code
3. Remove duplicate code from `shared.ts` and `service-worker.ts`

## Files to Update When Adding a Setting

Until this is fixed, when adding a new config setting you must update:

1. `src/device/PortalEmulatorConfig.ts`
   - `PortalEmulatorConfig` interface
   - `DEFAULT_CONFIG` constant
   - `normalizeConfigShape()` function

2. `src/context/shared.ts`
   - `PortalEmulatorConfig` interface
   - `DEFAULT_CONFIG` constant
   - `ensureConfigDefaults()` function
   - `normalizeConfig()` function

3. `immersive-web-emulator/src/service-worker.ts`
   - `PortalEmulatorConfig` interface
   - `DEFAULT_CONFIG` constant
   - `ensureConfigDefaults()` function
   - `normalizeConfig()` function

4. `devui/src/components/DevUIRoot.tsx`
   - `EmulatorSettingsState` type
   - `readSettings()` function
   - UI component for the setting
   - Toggle handler callback
