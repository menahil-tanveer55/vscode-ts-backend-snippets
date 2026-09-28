# VS Code TypeScript Backend Snippets

A personal, growing collection of VS Code snippets for building Node.js / Express backends in TypeScript. Copy `typescript.json` into your VS Code snippets folder and get instant boilerplate for the app and server entry points, routes, controllers, services, middleware, errors and Jest tests.

> Focused on backend development. More snippets are added as real patterns emerge from building apps.

![Demo: typing xp- snippets in VS Code to scaffold an Express backend](./docs/demo.gif)

---

## Installation

1. Open VS Code.
2. Press `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Windows/Linux).
3. Run **"Snippets: Configure User Snippets"** and choose **"typescript"**.
4. Replace the contents of the file with [`typescript.json`](./typescript.json) from this repo (or merge the entries if you already have snippets).

The snippets are registered for the `typescript` language, so they are available in `.ts` files only. They do not appear in `.tsx` files, which use the separate `typescriptreact` language.

---

## Naming

Every prefix starts with `xp-` (short for Express), so the snippets never collide with other extensions and typing `xp-` lists the whole collection.

Names are hierarchical: `xp-<category>-<variant>`. Typing a category lists the whole group:

- `xp-mw` shows every middleware (`xp-mw-base`, `xp-mw-auth`, `xp-mw-error`, `xp-mw-idempotency`)
- `xp-error` shows every error class (`xp-error-base`, the `AppError` that other error classes extend)
- `xp-test` shows every test type (`xp-test-api`, `xp-test-unit`)

New snippets follow the same scheme, for example `xp-mw-validate`, `xp-mw-log`, `xp-test-api`, or `xp-error-*` subclasses of `AppError` such as a not-found error.

---

## Conventions

The generated code assumes:

- **ESM with NodeNext**: `"type": "module"` in `package.json`, and `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true` in `tsconfig.json`.
- **`.js` import extensions**: relative imports end in `.js` (for example `'../services/userService.js'`), even though the source file is `.ts`. This is what NodeNext requires, because the path must match the emitted file.
- **Express 5** with `@types/express` v5.
- **Errors flow to the error middleware**: Express 5 forwards rejected promises from async handlers automatically, so controllers and services do not catch errors just to log them or turn them into responses. Throw an `AppError` (`xp-error-base`) for expected failures such as "not found". `xp-mw-error` turns it into a response, and turns anything else into a generic 500.
- **Validated request bodies**: controllers assume `req.body` has already been validated. `xp-mw-validate` (planned) will provide this.
- `import type` for type-only imports.

---

## Snippets

| Category   | Prefix              | Name                   | Description                                                                  |
| ---------- | ------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| App        | `xp-app`            | Express App            | `app.ts`: Express app with JSON parsing, restricted CORS and a health route  |
| App        | `xp-server`         | Express Server         | `server.ts`: starts the app and shuts down gracefully on SIGTERM / SIGINT     |
| Routing    | `xp-route`          | Express Route File     | Express Router with GET and POST handlers wired to a controller              |
| Routing    | `xp-controller`     | Express Controller     | Async controller that calls a service; errors reach the error middleware     |
| Middleware | `xp-mw-base`        | Middleware             | Generic Express middleware                                                   |
| Middleware | `xp-mw-log`         | Request Logger         | Logs method, URL, status and duration on response close, including aborts    |
| Middleware | `xp-mw-auth`        | Auth Middleware        | Bearer token extraction and verification                                     |
| Middleware | `xp-mw-error`       | Error Middleware       | 4-argument error handler: `AppError` and 4xx client errors, generic 500 else |
| Middleware | `xp-mw-idempotency` | Idempotency Middleware | `Idempotency-Key` handling with payload hashing and response replay          |
| Errors     | `xp-error-base`     | App Error              | `AppError` class with `statusCode`, `isOperational` and `cause`              |
| Data       | `xp-service`        | Service Class          | Typed service class with an async method skeleton                            |
| Data       | `xp-types`          | Types File             | Status union type plus entity, request and response interfaces               |
| Data       | `xp-mockdb`         | Map Mock DB            | In-memory Map database plus the idempotency store                            |
| Tests      | `xp-test-api`       | API Integration Test   | Supertest request against the Express app                                    |
| Tests      | `xp-test-unit`      | Jest Unit Test         | Jest `describe` + `beforeEach` + `it.todo` for a service                     |

---

## Snippet Details

### App

#### `xp-app`: Express App

Scaffolds `app.ts`. It creates and exports the app but does not listen, so tests can import the app without opening a port. Tab stop: the allowed CORS origin (there is deliberately no wide-open default). The cursor lands where routers are mounted.

```ts
import express from 'express';
import cors from 'cors';

export const app = express();

app.use(cors({ origin: 'https://app.example.com' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount routers here, for example:
// app.use('/api/items', itemsRouter);

// Register the error middleware last, after every router:
// app.use(errorMiddleware);
```

---

#### `xp-server`: Express Server

Scaffolds `server.ts`, the process entry point. On SIGTERM or SIGINT it stops accepting connections, waits for in-flight requests, then exits. If that takes longer than the timeout it forces an exit with code 1. Tab stops: default port, shutdown timeout.

```ts
import { app } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(PORT, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`Server running on http://localhost:${PORT}`);
});

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully`);

  // Force exit if open connections keep the server from closing in time.
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

---

### Routing

#### `xp-route`: Express Route File

Scaffolds an Express router. Tab stops: `controllerName`, `controllerFile`, `path`.

```ts
import { Router } from 'express';
import { controllerName } from '../controllers/controllerFile.js';

const router = Router();

router.get('/path', controllerName);
router.post('/path', controllerName);

export default router;
```

---

#### `xp-controller`: Express Controller

Async controller that reads from `req.body`, calls a service method and returns JSON. There is no try/catch: Express 5 forwards a rejected promise to the error middleware, which picks the status code and hides internal details. Tab stops: `ServiceName`, `serviceName`, `functionName`, the body field passed to the service, `methodName`.

```ts
import type { Request, Response } from 'express';
import { ServiceName } from '../services/serviceName.js';

const service = new ServiceName();

// No try/catch: Express 5 forwards rejected promises from async handlers
// to the error middleware, which decides the status code and response body.
export const functionName = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.body;

  const result = await service.methodName(id);

  res.status(200).json({ data: result });
};
```

---

### Middleware

#### `xp-mw-base`: Middleware

Generic middleware skeleton. Express 5 forwards thrown errors (and rejected promises, if you make it `async`) to the error middleware, so no try/catch is needed. Tab stop: `middlewareName`.

```ts
import type { Request, Response, NextFunction } from 'express';

// No try/catch: Express 5 forwards thrown errors (and rejected promises, if you
// make this async) to the error middleware.
export const middlewareName = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // your logic here
  next();
};
```

---

#### `xp-mw-log`: Request Logger Middleware

Middleware that records request arrival time with monotonic `performance.now()` and logs the method, URL, status and elapsed duration when the response closes. It labels the status as `aborted` when `res.writableFinished` is false. Tab stop: `requestLogger`.

```ts
import type { Request, Response, NextFunction } from 'express';

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = performance.now();

  res.on('close', () => {
    const duration = performance.now() - start;
    const status = res.writableFinished ? res.statusCode : 'aborted';
    console.log(
      `${req.method} ${req.originalUrl} ${status} - ${duration}ms`
    );
  });

  next();
};
```

---

#### `xp-mw-auth`: Auth Middleware

Extracts a `Bearer` token from the `Authorization` header without assuming the header is well formed, then verifies it. A missing, malformed or invalid token gets a 401. An unexpected failure during verification (for example the key store is down) is forwarded with `next(error)` so it becomes a 500, not a misleading 401.

Tab stops: `verifyToken` (your verification function, which should resolve to the user or `null`), its module path, `authMiddleware`. The cursor lands where you attach the user to the request. To type `req.user`, use [Express Request declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#global-augmentation) as shown in the comment.

```ts
import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../auth/verifyToken.js';

// To set req.user, add it to Express's Request type with declaration merging,
// for example in src/types/express.d.ts:
//   declare global {
//     namespace Express {
//       interface Request { user?: AuthUser }
//     }
//   }
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // A missing header or one without a space yields undefined parts, never a throw.
  const [scheme, token] = req.get('Authorization')?.split(' ') ?? [];

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // verifyToken should resolve to the user for a valid token, resolve to
    // null for an invalid or expired one, and throw only on unexpected failures.
    const user = await verifyToken(token);

    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // req.user = user; (once the declaration merging above is in place)
  } catch (error) {
    // Unexpected failure (for example the key store is down): not the client's
    // fault, so forward it to the error middleware instead of answering 401.
    next(error);
    return;
  }

  next();
};
```

---

#### `xp-mw-error`: Error Middleware

Final error handler. It checks, in order:

1. **Response already started** (`res.headersSent`): it cannot be replaced, so the error goes to `next(error)` and Express's default handler closes the connection.
2. **Operational `AppError`** (see `xp-error-base`): returned with its own status code and message.
3. **Exposed client error** in the http-errors style, raised by Express and its body parser: a 4xx `status` with `expose === true`, for example malformed JSON (400) or an oversized body (413). Returned with its status and message, and not logged as unhandled.
4. **Anything else**: logged in full on the server, and the client only sees a generic 500, so raw messages and stack traces never leak.

Tab stop: the path to `AppError`. Express recognises an error handler by its four parameters, so keep all four. Register it with `app.use(errorMiddleware)` after every router.

```ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';

// Client errors in the http-errors style raised by Express and its body parser,
// for example malformed JSON (400) or an oversized body (413).
interface ExposedClientError {
  status: number;
  message: string;
  expose: true;
}

const isExposedClientError = (error: unknown): error is ExposedClientError =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number' &&
  error.status >= 400 &&
  error.status <= 499 &&
  'expose' in error &&
  error.expose === true &&
  'message' in error &&
  typeof error.message === 'string';

// Express only treats a middleware as an error handler when it declares all four
// parameters.
export const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // The response has already started and cannot be replaced. Express's default
  // handler will close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError && error.isOperational) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (isExposedClientError(error)) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  // Unknown or programmer error: log everything server side, expose nothing.
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, error);
  res.status(500).json({ error: 'Internal server error' });
};
```

---

#### `xp-mw-idempotency`: Idempotency Middleware

Makes a route safe to retry. Add it to routes that require a key, for example `router.post('/payments', idempotency, createPayment)`. Tab stops: path to the store created by `xp-mockdb`, middleware name.

| Situation                                        | Response                          |
| ------------------------------------------------ | --------------------------------- |
| No `Idempotency-Key` header                      | 400                               |
| Key reused with a different request              | 422                               |
| Key reused while the first request is running    | 409                               |
| Key reused after the first request succeeded     | Stored response, replayed exactly |
| First request failed (non-2xx or no JSON sent)   | Key released so the client can retry |

The request fingerprint is a sha256 hash of the method, URL and body.

**Single process only.** The store is an in-memory `Map`: it is not shared between instances, entries never expire, and it is lost on restart. In production use an atomic store, for example Redis `SET key value NX EX <ttl>` or an insert guarded by a database unique constraint. Otherwise concurrent duplicates hitting different instances can race and both be processed. Also scope keys per client (for example user id + key).

```ts
import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { processedRequests } from '../db/mockDb.js';

// WARNING: single process only. The Map lives in this process's memory: it is
// not shared between instances, entries never expire, and it is lost on restart.
// Production needs an atomic store, for example Redis `SET key value NX EX <ttl>`
// or an insert guarded by a database unique constraint on the key. Without one,
// concurrent duplicates hitting different instances can both pass the check and
// be processed twice. Also scope keys per client (for example user id + key).
export const idempotency = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const key = req.get('Idempotency-Key');

  if (!key) {
    res.status(400).json({ error: 'Idempotency-Key header is required' });
    return;
  }

  const requestHash = createHash('sha256')
    .update(JSON.stringify([req.method, req.originalUrl, req.body ?? null]))
    .digest('hex');

  const existing = processedRequests.get(key);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      res.status(422).json({ error: 'Idempotency-Key was already used with a different request' });
      return;
    }

    if (existing.status === 'in_progress') {
      res.status(409).json({ error: 'A request with this Idempotency-Key is still in progress' });
      return;
    }

    res.set('Idempotent-Replayed', 'true');
    res.status(existing.response.statusCode).json(existing.response.body);
    return;
  }

  processedRequests.set(key, { status: 'in_progress', requestHash });

  // Capture the handler's JSON response so completed duplicates can replay it.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      processedRequests.set(key, {
        status: 'completed',
        requestHash,
        response: { statusCode: res.statusCode, body },
      });
    } else {
      // Failed requests release the key so the client can retry with it.
      processedRequests.delete(key);
    }
    return originalJson(body);
  };

  // Release the key if the response ends without res.json (for example the client disconnects).
  res.on('close', () => {
    if (processedRequests.get(key)?.status === 'in_progress') {
      processedRequests.delete(key);
    }
  });

  next();
};
```

---

### Errors

#### `xp-error-base`: App Error

Error class for expected failures that should reach the client, for example `throw new AppError('User not found', 404)`. Pass `{ cause }` when wrapping a lower-level error so its stack is kept. Pass `{ isOperational: false }` to mark a programmer error, which `xp-mw-error` hides behind a generic 500. `this.name` follows the concrete class, so subclasses such as `class NotFoundError extends AppError` log with their own name.

```ts
export interface AppErrorOptions {
  cause?: unknown;
  /** false marks a programmer error: the error middleware hides it behind a 500. */
  isOperational?: boolean;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    { cause, isOperational = true }: AppErrorOptions = {}
  ) {
    super(message, { cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}
```

---

### Data

#### `xp-service`: Service Class

Typed service class with one async method. The body throws `Not implemented` until you write it, so an unfinished method fails loudly and never returns `undefined`. Errors are not caught and rewrapped: a generic wrapper adds nothing the stack trace does not already show, and it would turn an `AppError` (such as a 404) into a 500. When you do need to add context, keep the original error as the cause: `throw new Error('methodName failed', { cause: error })`.

Tab stops: `TypeName` (also the return type), `typesFile`, `ServiceName`, `methodName`, parameter name, parameter type.

```ts
import type { TypeName } from '../types/typesFile.js';

export class ServiceName {
  async methodName(id: string): Promise<TypeName> {

    throw new Error('Not implemented');
  }
}
```

---

#### `xp-types`: Types File

Status union + three interfaces (entity, request, response). Tab stops: `StatusType`, `MainEntity`, `RequestType`, `ResponseType`.

```ts
export type StatusType = 'pending' | 'approved' | 'declined';

export interface MainEntity {
  id: string;
}

export interface RequestType {
}

export interface ResponseType {
}
```

---

#### `xp-mockdb`: Map Mock DB

Map-based in-memory store for prototyping and tests, with no database setup. It also exports `processedRequests`, the store used by `xp-mw-idempotency`. Each record has a `status` (`in_progress` or `completed`), a `requestHash` and, once completed, the stored `response`. Tab stops: `EntityType`, `typesFile`, `entityName`, first record id.

```ts
import type { EntityType } from '../types/typesFile.js';

export const entityNames = new Map<string, EntityType>([
  ['id-001', {
    id: 'id-001',
  }],
]);

// Idempotency store used by xp-mw-idempotency. In memory, so single process only.
export type IdempotencyRecord =
  | { status: 'in_progress'; requestHash: string }
  | {
      status: 'completed';
      requestHash: string;
      response: { statusCode: number; body: unknown };
    };

export const processedRequests = new Map<string, IdempotencyRecord>();
```

---

### Tests

#### `xp-test-api`: Supertest API Integration Test

Sends an HTTP request to the Express app exported by `xp-app`, without opening a listening server. It uses the generated health route as a starting example; adapt the path and assertions to the endpoint under test. Tab stop: request path.

```ts
import request from 'supertest';
import { app } from '../app.js';

describe('GET /health', () => {
  it('returns a successful response', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

---

#### `xp-test-unit`: Jest Unit Test

Jest test file for a service class. The placeholder is `it.todo`, which Jest reports as pending, so an unwritten test cannot pass silently. A commented Arrange / Act / Assert skeleton is included to replace it. Tab stops: `ServiceName`, `serviceName`, test description.

```ts
import { ServiceName } from '../services/serviceName.js';

describe('ServiceName', () => {
  let service: ServiceName;

  beforeEach(() => {
    service = new ServiceName();
  });

  // Shows as pending until replaced with a real test, so it cannot pass silently.
  it.todo('should do something');

  // it('should do something', async () => {
  //   // Arrange
  //
  //   // Act
  //   const result = await service.method();
  //
  //   // Assert
  //   expect(result).toEqual(expected);
  // });
});
```

---

## Verifying the Snippets

```sh
npm install
npm run verify
```

[`scripts/verify-snippets.ts`](./scripts/verify-snippets.ts) checks that every prefix starts with `xp-`, that no two snippets share a prefix, and that tab stops and escaped `$` signs are valid. It then expands every snippet with its default values into a temporary strict NodeNext project, stubs the sibling files they import, and runs `tsc --noEmit`. Pass `-- --keep` to keep the temporary project for inspection.

---

## Planned Additions

Snippets that will be added as patterns come up in real projects:

- `xp-mw-validate`: Zod request validation middleware
- `xp-mw-rate-limit`: rate-limit middleware
- Prisma service method
- JWT sign / verify helpers

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[MIT](./LICENSE)
