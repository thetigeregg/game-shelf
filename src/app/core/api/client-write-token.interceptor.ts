import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CLIENT_WRITE_TOKEN_HEADER_NAME,
  ClientWriteAuthService
} from '../services/client-write-auth.service';

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class ClientWriteTokenInterceptor implements HttpInterceptor {
  private readonly clientWriteAuth = inject(ClientWriteAuthService);
  private readonly apiBaseUrl = this.normalizeBaseUrl(environment.gameApiBaseUrl);

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!MUTATING_HTTP_METHODS.has(request.method.toUpperCase())) {
      return next.handle(request);
    }

    if (!this.isApiRequest(request.url)) {
      return next.handle(request);
    }

    if (request.headers.has(CLIENT_WRITE_TOKEN_HEADER_NAME)) {
      return next.handle(request);
    }

    const token = this.clientWriteAuth.getToken();

    if (!token) {
      return next.handle(request);
    }

    return next.handle(
      request.clone({
        setHeaders: {
          [CLIENT_WRITE_TOKEN_HEADER_NAME]: token
        }
      })
    );
  }

  private normalizeBaseUrl(value: string): string {
    const normalized = String(value ?? '').trim();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }

  private isApiRequest(url: string): boolean {
    if (this.apiBaseUrl.length === 0) {
      return false;
    }

    const normalizedUrl = String(url ?? '').trim();
    return normalizedUrl === this.apiBaseUrl || normalizedUrl.startsWith(`${this.apiBaseUrl}/`);
  }
}
