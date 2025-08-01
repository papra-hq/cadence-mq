export type CadenceLoggerArgs = [data: Record<string, unknown>, message: string] | [message: string];

export type CadenceLogger = {
  debug: (...args: CadenceLoggerArgs) => void;
  info: (...args: CadenceLoggerArgs) => void;
  warn: (...args: CadenceLoggerArgs) => void;
  error: (...args: CadenceLoggerArgs) => void;
};
