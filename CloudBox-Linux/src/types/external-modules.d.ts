declare module 'node-7z' {
  interface SevenEntry {
    datetime?: Date;
    attributes?: string;
    size?: number;
    sizeCompressed?: number;
    file?: string;
  }

  interface SevenStream {
    on(event: 'data', listener: (entry: SevenEntry) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'end', listener: () => void): this;
  }

  interface SevenOptions {
    $bin?: string;
    yes?: boolean;
    [key: string]: unknown;
  }

  interface Seven {
    list(target: string, options?: SevenOptions): SevenStream;
    extractFull(archive: string, output: string, options?: SevenOptions): SevenStream;
  }

  const seven: Seven;
  export default seven;
}

declare module 'clamscan' {
  interface ClamScanResult {
    isInfected: boolean;
    viruses?: string[];
    [key: string]: unknown;
  }

  class NodeClam {
    init(options: Record<string, unknown>): Promise<NodeClam>;
    isInfected(filePath: string): Promise<ClamScanResult>;
  }

  export default NodeClam;
}
