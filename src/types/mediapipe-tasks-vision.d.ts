declare module '@mediapipe/tasks-vision' {
  export type FaceLandmarkerDelegate = 'GPU' | 'CPU';

  export type FaceLandmarkerBaseOptions = {
    modelAssetPath: string;
    delegate: FaceLandmarkerDelegate;
  };

  export type FaceLandmarkerOptions = {
    baseOptions: FaceLandmarkerBaseOptions;
    runningMode: 'VIDEO';
    numFaces: number;
    outputFaceBlendshapes: boolean;
    outputFacialTransformationMatrixes: boolean;
  };

  export type FaceLandmarkerResult = {
    faceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
    facialTransformationMatrixes?: Array<{ data: Float32Array | number[] }>;
  };

  export type WasmFileset = {
    wasmLoaderPath: string;
    wasmBinaryPath: string;
    assetLoaderPath?: string;
    assetBinaryPath?: string;
  };

  export interface FaceLandmarker {
    detectForVideo(video: HTMLVideoElement, timestamp: number): FaceLandmarkerResult;
    close?: () => void;
  }

  export interface FaceLandmarkerWithAsync extends FaceLandmarker {
    detectAsync?(video: HTMLVideoElement, timestamp: number): Promise<FaceLandmarkerResult>;
  }

  export const FaceLandmarker: {
    createFromOptions(
      vision: WasmFileset,
      options: FaceLandmarkerOptions,
    ): Promise<FaceLandmarkerWithAsync>;
  };

  export const FilesetResolver: {
    forVisionTasks(wasmPath?: string): Promise<WasmFileset>;
    isSimdSupported(): Promise<boolean>;
  };
}
