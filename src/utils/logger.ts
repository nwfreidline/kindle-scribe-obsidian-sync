/**
 * Simple structured logger for the plugin.
 * Prefixes all messages with [Kindle Scribe] for easy filtering in console.
 */

const PREFIX = "[Kindle Scribe]";

export const logger = {
  info(message: string, ...args: any[]): void {
    console.log(`${PREFIX} ${message}`, ...args);
  },

  warn(message: string, ...args: any[]): void {
    console.warn(`${PREFIX} ${message}`, ...args);
  },

  error(message: string, ...args: any[]): void {
    console.error(`${PREFIX} ${message}`, ...args);
  },

  debug(message: string, ...args: any[]): void {
    // Only log in development (when sourcemaps are present)
    if (process.env.NODE_ENV !== "production") {
      console.debug(`${PREFIX} ${message}`, ...args);
    }
  },
};
