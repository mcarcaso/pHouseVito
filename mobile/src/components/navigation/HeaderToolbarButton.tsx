import { HeaderButton } from "@react-navigation/elements";
import type { ComponentProps, PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

export type HeaderToolbarButtonProps = PropsWithChildren<
  Omit<ComponentProps<typeof HeaderButton>, "children" | "style">
>;

/**
 * The only button primitive used in native stack toolbar slots.
 *
 * iOS sizes its toolbar chrome independently from React children. Giving every
 * action the same explicit 44-point frame keeps the glyph centered inside the
 * system button instead of aligning a content-sized Pressable to one edge.
 */
export function HeaderToolbarButton({ children, ...props }: HeaderToolbarButtonProps) {
  return (
    <HeaderButton {...props} style={styles.button}>
      {children}
    </HeaderButton>
  );
}

export function HeaderToolbarButtonGroup({ children }: PropsWithChildren) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
  },
});
