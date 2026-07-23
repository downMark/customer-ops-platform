import { useContext } from "react";
import { useSearchParams } from "react-router-dom";
import KoaContext from "./KoaContext";

const useAppSearchParams = () => {
  const koaContext = useContext(KoaContext);
  const [searchParams, setSearchParams] = useSearchParams(
    koaContext ? koaContext?.request?.query : undefined
  );

  return [searchParams, setSearchParams];
};

export default useAppSearchParams;
