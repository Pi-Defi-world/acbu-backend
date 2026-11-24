declare module "papaparse" {
  export interface ParseResult<T = any> {
    data: T[];
    errors: any[];
    meta: any;
  }

  export function parse<T = any>(input: string, config?: any): ParseResult<T>;

  const Papa: { parse: typeof parse };
  export default Papa;
}
