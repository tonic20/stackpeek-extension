interface ImportMetaEnv {
  readonly WXT_API_BASE?: string;
  // Injected by shots/vite.harness.config.ts only. The shipped extension reads
  // its messages from _locales/ through browser.i18n and never sees this.
  readonly SP_MESSAGES_BY_LOCALE?: Record<string, Record<string, { message: string }>>;
  readonly SP_LOCALE_TAGS?: Record<string, string>;
}
