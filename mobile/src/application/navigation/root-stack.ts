import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./route-types";

export const RootStack = createNativeStackNavigator<RootStackParamList>();
