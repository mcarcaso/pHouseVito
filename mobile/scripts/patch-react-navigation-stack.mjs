import { readFileSync, writeFileSync } from "node:fs";

const packageRoot = new URL("../node_modules/@react-navigation/stack/", import.meta.url);

function replaceRequired(source, oldText, newText, file) {
  if (source.includes(newText)) return source;
  if (!source.includes(oldText))
    throw new Error(`Unsupported @react-navigation/stack file: ${file.pathname}`);
  return source.replace(oldText, newText);
}

function patchA11yWrapper(file, source) {
  if (file.pathname.endsWith(".js")) {
    source = replaceRequired(
      source,
      "  const isHidden = !animated && isNextScreenTransparent === false && detachCurrentScreen !== false && !focused;",
      "  const interactiveBehindTransparent = Platform.OS === 'web' && isNextScreenTransparent;\n  const isHidden = !animated && isNextScreenTransparent === false && detachCurrentScreen !== false && !focused;",
      file,
    );
    source = replaceRequired(
      source,
      '"aria-hidden": !focused,',
      '"aria-hidden": !focused && !interactiveBehindTransparent,',
      file,
    );
    source = replaceRequired(
      source,
      "pointerEvents: (animated ? inert : !focused) ? 'none' : 'box-none',",
      "pointerEvents: (animated ? inert : !focused && !interactiveBehindTransparent) ? 'none' : 'box-none',",
      file,
    );
    source = replaceRequired(
      source,
      "  detachCurrentScreen,\n  children",
      "  detachCurrentScreen,\n  style,\n  children",
      file,
    );
    return replaceRequired(
      source,
      "style: [StyleSheet.absoluteFill, {",
      "style: [StyleSheet.absoluteFill, style, {",
      file,
    );
  }

  source = replaceRequired(
    source,
    "import { Platform, StyleSheet, View } from 'react-native';",
    "import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';",
    file,
  );
  source = replaceRequired(
    source,
    "  detachCurrentScreen: boolean;\n  children: React.ReactNode;",
    "  detachCurrentScreen: boolean;\n  style?: ViewStyle;\n  children: React.ReactNode;",
    file,
  );
  source = replaceRequired(
    source,
    "      detachCurrentScreen,\n      children,",
    "      detachCurrentScreen,\n      style,\n      children,",
    file,
  );
  source = replaceRequired(
    source,
    "    const isHidden =",
    "    const interactiveBehindTransparent = Platform.OS === 'web' && isNextScreenTransparent;\n\n    const isHidden =",
    file,
  );
  source = replaceRequired(
    source,
    "aria-hidden={!focused}",
    "aria-hidden={!focused && !interactiveBehindTransparent}",
    file,
  );
  source = replaceRequired(
    source,
    "pointerEvents={(animated ? inert : !focused) ? 'none' : 'box-none'}",
    "pointerEvents={(animated ? inert : !focused && !interactiveBehindTransparent) ? 'none' : 'box-none'}",
    file,
  );
  return replaceRequired(
    source,
    "          StyleSheet.absoluteFill,\n          {",
    "          StyleSheet.absoluteFill,\n          style,\n          {",
    file,
  );
}

function patchCard(file, source) {
  if (file.pathname.endsWith(".js")) {
    return replaceRequired(
      source,
      "children: /*#__PURE__*/_jsx(PanGestureHandler, {\n        enabled:",
      "children: /*#__PURE__*/_jsx(PanGestureHandler, {\n        pointerEvents: Platform.OS === 'web' ? 'box-none' : undefined,\n        enabled:",
      file,
    );
  }
  return replaceRequired(
    source,
    "        <PanGestureHandler\n          enabled=",
    "        <PanGestureHandler\n          pointerEvents={Platform.OS === 'web' ? 'box-none' : undefined}\n          enabled=",
    file,
  );
}

function patchCardContainer(file, source) {
  if (file.pathname.endsWith(".js")) {
    source = replaceRequired(
      source,
      "import { StyleSheet, View } from 'react-native';",
      "import { Platform, StyleSheet, View } from 'react-native';",
      file,
    );
    source = replaceRequired(
      source,
      "  const animated = animation !== 'none';\n  return /*#__PURE__*/_jsx(CardA11yWrapper, {",
      "  const animated = animation !== 'none';\n  const interactivePane = Platform.OS === 'web' && presentation === 'transparentModal';\n  return /*#__PURE__*/_jsx(CardA11yWrapper, {",
      file,
    );
    source = replaceRequired(
      source,
      "    detachCurrentScreen: detachCurrentScreen,\n    children:",
      "    detachCurrentScreen: detachCurrentScreen,\n    style: interactivePane ? cardStyle : undefined,\n    children:",
      file,
    );
    return replaceRequired(
      source,
      "      }, cardStyle],",
      "      }, interactivePane ? undefined : cardStyle],",
      file,
    );
  }

  source = replaceRequired(
    source,
    "import { Animated, StyleSheet, View } from 'react-native';",
    "import { Animated, Platform, StyleSheet, View } from 'react-native';",
    file,
  );
  source = replaceRequired(
    source,
    "  const animated = animation !== 'none';\n\n  return (",
    "  const animated = animation !== 'none';\n  const interactivePane = Platform.OS === 'web' && presentation === 'transparentModal';\n\n  return (",
    file,
  );
  source = replaceRequired(
    source,
    "      detachCurrentScreen={detachCurrentScreen}\n    >",
    "      detachCurrentScreen={detachCurrentScreen}\n      style={interactivePane ? cardStyle : undefined}\n    >",
    file,
  );
  return replaceRequired(
    source,
    "          cardStyle,\n        ]}",
    "          interactivePane ? undefined : cardStyle,\n        ]}",
    file,
  );
}

const files = [
  ["lib/module/views/Stack/CardA11yWrapper.js", patchA11yWrapper],
  ["src/views/Stack/CardA11yWrapper.tsx", patchA11yWrapper],
  ["lib/module/views/Stack/Card.js", patchCard],
  ["src/views/Stack/Card.tsx", patchCard],
  ["lib/module/views/Stack/CardContainer.js", patchCardContainer],
  ["src/views/Stack/CardContainer.tsx", patchCardContainer],
];

for (const [relativePath, patch] of files) {
  const file = new URL(relativePath, packageRoot);
  const source = readFileSync(file, "utf8");
  writeFileSync(file, patch(file, source));
}
