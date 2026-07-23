import axios, { AxiosResponse } from "axios";
import { getClientApiBaseURL, getServerApiBaseURL } from "../../config/env";

export const getApiBaseURL = () =>
  typeof window === "undefined" ? getServerApiBaseURL() : getClientApiBaseURL();

axios.defaults.baseURL = getApiBaseURL();

axios.interceptors.response.use(
  ({ data }: AxiosResponse) => {
    return data;
  },
  (error) => Promise.reject(error)
);

export default axios;
