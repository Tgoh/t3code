interface ImportMeta {
  readonly env: { readonly MODE: string; readonly DEV: boolean; readonly PROD: boolean };
}

declare module "*.css";

declare module "*?worker&url" {
  const url: string;
  export default url;
}
