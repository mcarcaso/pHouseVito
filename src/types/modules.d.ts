// Module declarations for packages without proper type definitions
// This is a workaround for npm not installing @types packages properly

declare module 'express' {
  import type { IncomingMessage, ServerResponse, RequestListener } from 'http';
  
  interface Request extends IncomingMessage {
    body: any;
    params: any;
    query: any;
    cookies: any;
    headers: { 
      [key: string]: string | undefined; 
      host?: string;
      cookie?: string;
      authorization?: string;
    };
    path: string;
    url: string;
    originalUrl: string;
    method: string;
    ip: string;
    ips: string[];
  }
  
  interface Response extends ServerResponse {
    json(body: any): Response;
    status(code: number): Response;
    send(body: any): Response;
    sendFile(path: string, options?: any, callback?: (err?: any) => void): void;
    set(field: string, value: string): Response;
    redirect(url: string): void;
    redirect(status: number, url: string): void;
  }
  
  type NextFunction = (err?: any) => void;
  type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
  
  interface Router {
    get(path: string, ...handlers: RequestHandler[]): Router;
    post(path: string, ...handlers: RequestHandler[]): Router;
    put(path: string, ...handlers: RequestHandler[]): Router;
    delete(path: string, ...handlers: RequestHandler[]): Router;
    use(...handlers: RequestHandler[]): Router;
    use(path: string, ...handlers: RequestHandler[]): Router;
  }
  
  interface Application extends Router {
    (req: IncomingMessage, res: ServerResponse): void;
    listen(port: number, callback?: () => void): any;
    listen(port: number, host: string, callback?: () => void): any;
  }
  
  interface Express {
    (): Application;
    static(root: string, options?: any): RequestHandler;
    json(options?: any): RequestHandler;
    urlencoded(options?: any): RequestHandler;
    Router(): Router;
  }
  
  const express: Express;
  export = express;
}

declare module 'better-sqlite3' {
  interface Statement {
    run(...params: any[]): Database.RunResult;
    get(...params: any[]): any;
    all(...params: any[]): any[];
    iterate(...params: any[]): IterableIterator<any>;
    pluck(toggle?: boolean): this;
    expand(toggle?: boolean): this;
    raw(toggle?: boolean): this;
    bind(...params: any[]): this;
    columns(): Database.ColumnDefinition[];
    safeIntegers(toggle?: boolean): this;
  }

  interface Transaction<F extends (...args: any[]) => any> {
    (...args: Parameters<F>): ReturnType<F>;
    default(...args: Parameters<F>): ReturnType<F>;
    deferred(...args: Parameters<F>): ReturnType<F>;
    immediate(...args: Parameters<F>): ReturnType<F>;
    exclusive(...args: Parameters<F>): ReturnType<F>;
  }

  namespace BetterSqlite3 {
    interface Statement {
      run(...params: any[]): RunResult;
      get(...params: any[]): any;
      all(...params: any[]): any[];
      iterate(...params: any[]): IterableIterator<any>;
      pluck(toggle?: boolean): this;
      expand(toggle?: boolean): this;
      raw(toggle?: boolean): this;
      bind(...params: any[]): this;
      columns(): ColumnDefinition[];
      safeIntegers(toggle?: boolean): this;
    }

    interface Transaction<F extends (...args: any[]) => any> {
      (...args: Parameters<F>): ReturnType<F>;
      default(...args: Parameters<F>): ReturnType<F>;
      deferred(...args: Parameters<F>): ReturnType<F>;
      immediate(...args: Parameters<F>): ReturnType<F>;
      exclusive(...args: Parameters<F>): ReturnType<F>;
    }

    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface ColumnDefinition {
      name: string;
      column: string | null;
      table: string | null;
      database: string | null;
      type: string | null;
    }

    interface PragmaOptions {
      simple?: boolean;
    }

    interface RegistrationOptions {
      varargs?: boolean;
      deterministic?: boolean;
      safeIntegers?: boolean;
      directOnly?: boolean;
    }

    interface AggregateOptions extends RegistrationOptions {
      start?: any;
      step: (total: any, next: any) => any;
      inverse?: (total: any, dropped: any) => any;
      result?: (total: any) => any;
    }

    interface VirtualTableOptions {
      columns: string[];
      parameters?: string[];
      rows: () => Generator<any[]>;
      safeIntegers?: boolean;
      directOnly?: boolean;
    }

    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      verbose?: (message?: any, ...additionalArgs: any[]) => void;
      nativeBinding?: string;
    }

    interface Database {
      memory: boolean;
      readonly: boolean;
      name: string;
      open: boolean;
      inTransaction: boolean;

      prepare<BindParameters extends any[] | {} = any[]>(source: string): Statement;
      transaction<F extends (...args: any[]) => any>(fn: F): Transaction<F>;
      exec(source: string): this;
      pragma(source: string, options?: PragmaOptions): any;
      function(name: string, fn: (...args: any[]) => any): this;
      function(name: string, options: RegistrationOptions, fn: (...args: any[]) => any): this;
      aggregate(name: string, options: AggregateOptions): this;
      table(name: string, definition: VirtualTableOptions): this;
      loadExtension(path: string, entryPoint?: string): this;
      close(): this;
      defaultSafeIntegers(toggle?: boolean): this;
      unsafeMode(unsafe?: boolean): this;
      serialize(name?: string): Buffer;
    }

    interface DatabaseConstructor {
      new(filename: string, options?: Options): Database;
      (filename: string, options?: Options): Database;
    }
  }

  interface DatabaseConstructor {
    new(filename: string, options?: BetterSqlite3.Options): BetterSqlite3.Database;
    (filename: string, options?: BetterSqlite3.Options): BetterSqlite3.Database;
  }

  const Database: DatabaseConstructor;
  
  namespace Database {
    export type Database = BetterSqlite3.Database;
    export type Statement = BetterSqlite3.Statement;
    export type RunResult = BetterSqlite3.RunResult;
    export type Options = BetterSqlite3.Options;
  }
  
  export = Database;
}
