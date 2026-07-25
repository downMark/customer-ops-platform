import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import AppShell from "components/layout/AppShell";

const Index = () => {
  const { locales } = useParams();

  return (
    <>
      <Helmet htmlAttributes={{ lang: locales || "zh-CN", dir: "ltr" }}>
        <title>智能客服工作台</title>
        <meta
          name="description"
          content="智能客服控制台 — 实时订单信息与智能流式回复"
        />
      </Helmet>
      <AppShell />
    </>
  );
};

export default Index;
