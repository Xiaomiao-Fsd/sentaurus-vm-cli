export function shouldReadStdin(args: string[], stdinIsTty: boolean): boolean {
  return args.includes("-") || (args.length === 0 && !stdinIsTty);
}
