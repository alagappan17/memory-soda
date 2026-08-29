// Source imports end in `.js` (what the build emits) but tests run the `.ts`
// files directly. When a `.js` sibling does not exist, try the `.ts` one.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      try {
        return next(specifier, context);
      } catch (err) {
        if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
    }
    return next(specifier, context);
  },
});
