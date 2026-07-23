import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import AppShell from "components/layout/AppShell";

const Index = () => {
  const { locales } = useParams();

  return (
    <>
      <Helmet htmlAttributes={{ lang: locales || "zh-CN", dir: "ltr" }}>
        <title>Mastra 智能客服 · 客服控制台</title>
        <meta
          name="description"
          content="智能客服控制台 — 实时订单上下文与 AI 流式回复"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </Helmet>
      <AppShell />
    </>
  );
};

export default Index;
