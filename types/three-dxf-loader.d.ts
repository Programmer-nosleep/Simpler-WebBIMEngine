declare module "three-dxf-loader" {
  export type DXFLoadResult = {
    entity?: import("three").Object3D;
    dxf?: unknown;
  };

  export class DXFLoader {
    load(
      url: string,
      onLoad: (data: DXFLoadResult) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (event: unknown) => void
    ): void;

    setFont(font: unknown): void;
    setEnableLayer(enable: boolean): void;
    setDefaultColor(color: number): void;
    setConsumeUnits(enable: boolean): void;
  }

  export const THREEx: unknown;
}

