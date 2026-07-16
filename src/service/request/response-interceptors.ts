import type { AxiosResponse } from 'axios';

export const responseInterceptors = (response: AxiosResponse) => {
  return response.data;
};
