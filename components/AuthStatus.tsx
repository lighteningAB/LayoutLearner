import { useSession, signIn, signOut } from "next-auth/react";
import { Button, Flex } from "@chakra-ui/react";

export function AuthStatus() {
  const { data: session, status } = useSession();
  if (status === "loading") return <div>Loading...</div>;
  if (!session)
    return <Button onClick={() => signIn()}>Sign in</Button>;
  return (
    <Flex dir="row">
      Signed in as {session.user?.email || session.user?.name}
      <Button onClick={() => signOut()} ml = "0.5vw">Sign out</Button>
    </Flex>
  );
}

export default AuthStatus;