import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { AuthSession } from "apis/model/auth";
import AuthService from "apis/services/Auth";
import Icon from "components/Icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  loginSchema,
  type LoginFormValues,
} from "@/forms/schemas";

interface Props {
  onLogin: (session: AuthSession) => void;
}

const LoginScreen = ({ onLogin }: Props) => {
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const submit = async (values: LoginFormValues) => {
    form.clearErrors("root");
    try {
      const session = await AuthService.login(
        values.username.trim(),
        values.password,
      );
      form.resetField("password");
      onLogin(session);
    } catch (caught) {
      form.setError("root.server", { message: (caught as Error).message });
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface-container-low p-4 sm:p-6">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="p-5 pb-4 sm:p-8 sm:pb-4">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white">
            <Icon name="support_agent" filled />
          </div>
          <p className="text-xs font-bold tracking-widest text-primary">
            智能客服系统
          </p>
          <CardTitle className="text-2xl">登录智能客服工作台</CardTitle>
          <CardDescription>
            登录成功后才能访问客服聊天和订单数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 pt-2 sm:p-8 sm:pt-2">
          <form
            noValidate
            onSubmit={form.handleSubmit(submit)}
            className="grid gap-5"
          >
            <Field>
              <FieldLabel htmlFor="login-username">用户名</FieldLabel>
              <Input
                id="login-username"
                autoComplete="username"
                aria-invalid={Boolean(form.formState.errors.username)}
                {...form.register("username")}
              />
              <FieldError errors={[form.formState.errors.username]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="login-password">密码</FieldLabel>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                {...form.register("password")}
              />
              <FieldError errors={[form.formState.errors.password]} />
            </Field>

            {form.formState.errors.root?.server && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.server.message}
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={form.formState.isSubmitting}
              className="w-full"
            >
              {form.formState.isSubmitting ? "正在登录…" : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

export default LoginScreen;
