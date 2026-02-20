import { HTTP_INTERCEPTORS, HttpClient, HttpHeaders } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CLIENT_WRITE_TOKEN_HEADER_NAME,
  ClientWriteAuthService
} from '../services/client-write-auth.service';
import { ClientWriteTokenInterceptor } from './client-write-token.interceptor';

describe('ClientWriteTokenInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let clientWriteAuth: ClientWriteAuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ClientWriteAuthService,
        {
          provide: HTTP_INTERCEPTORS,
          useClass: ClientWriteTokenInterceptor,
          multi: true
        }
      ]
    });

    localStorage.clear();
    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    clientWriteAuth = TestBed.inject(ClientWriteAuthService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('adds client write token header for mutating API requests', async () => {
    clientWriteAuth.setToken('device-token-a');
    const promise = firstValueFrom(
      httpClient.post(`${environment.gameApiBaseUrl}/v1/sync/push`, {})
    );

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/sync/push`);
    expect(req.request.headers.get(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe('device-token-a');
    req.flush({ ok: true });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('adds client write token when request targets API base URL exactly', async () => {
    clientWriteAuth.setToken('device-token-b');
    const promise = firstValueFrom(httpClient.post(`${environment.gameApiBaseUrl}`, {}));

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}`);
    expect(req.request.headers.get(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe('device-token-b');
    req.flush({ ok: true });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('does not add token header for non-mutating requests', async () => {
    clientWriteAuth.setToken('device-token-c');
    const promise = firstValueFrom(httpClient.get(`${environment.gameApiBaseUrl}/v1/health`));

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/health`);
    expect(req.request.headers.has(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe(false);
    req.flush({ ok: true });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('does not add token header for non-API URLs', async () => {
    clientWriteAuth.setToken('device-token-d');
    const promise = firstValueFrom(httpClient.post('/manuals/not-api', {}));

    const req = httpMock.expectOne('/manuals/not-api');
    expect(req.request.headers.has(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe(false);
    req.flush({ ok: true });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('does not override an explicit request token header', async () => {
    clientWriteAuth.setToken('device-token-e');
    const promise = firstValueFrom(
      httpClient.post(
        `${environment.gameApiBaseUrl}/v1/sync/pull`,
        {},
        {
          headers: new HttpHeaders({
            [CLIENT_WRITE_TOKEN_HEADER_NAME]: 'caller-token'
          })
        }
      )
    );

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/sync/pull`);
    expect(req.request.headers.get(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe('caller-token');
    req.flush({ ok: true });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('does not add token header when no device token is configured', async () => {
    const promise = firstValueFrom(
      httpClient.post(`${environment.gameApiBaseUrl}/v1/sync/push`, {})
    );

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/sync/push`);
    expect(req.request.headers.has(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe(false);
    req.flush({ ok: true });

    await expect(promise).resolves.toEqual({ ok: true });
  });
});
