declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }

  interface ConvertedImage {
    convert: () => Promise<Buffer>;
  }

  interface HeicConvert {
    (options: ConvertOptions): Promise<Buffer>;
    all: (options: ConvertOptions) => Promise<ConvertedImage[]>;
  }

  const convert: HeicConvert;

  export const all: HeicConvert["all"];
  export default convert;
}
