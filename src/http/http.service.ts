import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';

@Injectable()
export class HttpService {
  private readonly logger = new Logger(HttpService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.client = axios.create({
      timeout: this.configService.get<number>('HTTP_TIMEOUT_MS', 5000),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async postWithRetry<TRequest, TResponse>(
    url: string,
    body: TRequest,
    maxRetries = 3,
  ): Promise<TResponse> {
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < maxRetries) {
      attempt += 1;
      try {
        const response = await this.client.post<TResponse>(url, body);
        return response.data;
      } catch (error) {
        lastError = error as AxiosError;
        this.logger.warn(
          `HTTP POST failed (attempt ${attempt}/${maxRetries}) for ${url}: ${lastError.message}`,
        );

        if (attempt < maxRetries) {
          const waitMs = 100 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    throw (
      lastError ?? new Error(`HTTP POST failed after ${maxRetries} attempts`)
    );
  }
}
