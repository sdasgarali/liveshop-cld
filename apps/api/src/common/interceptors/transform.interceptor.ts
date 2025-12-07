import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    timestamp: string;
    requestId?: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      map((data) => {
        const response: ApiResponse<T> = {
          success: true,
          data: data?.data !== undefined ? data.data : data,
          meta: {
            timestamp: new Date().toISOString(),
          },
        };

        if (request.headers['x-request-id']) {
          response.meta.requestId = request.headers['x-request-id'];
        }

        if (data?.pagination) {
          response.meta.pagination = data.pagination;
        }

        return response;
      }),
    );
  }
}
