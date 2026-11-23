interface ImportMeta {
  readonly env: { readonly MODE: string; readonly DEV: boolean; readonly PROD: boolean };
}

declare module "*.css";

declare module "*.mp3" {
  const url: string;
  export default url;
}

declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

declare module "*?worker&url" {
  const url: string;
  export default url;
}
