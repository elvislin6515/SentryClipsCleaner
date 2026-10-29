export class CodedError extends Error {
  readonly detail: string;

  constructor(code: string, detail = "") {
    super(code);
    this.name = "CodedError";
    this.detail = detail;
  }
}
