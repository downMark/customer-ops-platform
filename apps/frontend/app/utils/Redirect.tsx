import { useNavigate } from "react-router-dom";
import { KoaConsumer } from "./KoaContext";

type RedirectProps = {
  to: string;
  status?: number;
};

const Redirect: React.FC<RedirectProps> = ({ to, status = 301 }) => {
  const navigate = useNavigate();

  return (
    <KoaConsumer>
      {(context) => {
        if (context) {
          context.redirect(to);
          context.status = status;
        } else {
          navigate(to);
        }
        return null;
      }}
    </KoaConsumer>
  );
};

export default Redirect;
