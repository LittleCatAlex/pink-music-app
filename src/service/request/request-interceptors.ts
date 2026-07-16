import { type InternalAxiosRequestConfig } from "axios";

export const requestInterceptors = async (config: InternalAxiosRequestConfig) => {
  if (config.useFormData) {
    const formData = new FormData();
    for (const key in config.data) {
      formData.append(key, config.data[key]);
    }
    config.data = formData;
  }

  return config;
};
