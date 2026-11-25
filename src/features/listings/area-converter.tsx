import { Grid2x2, Ruler, Scan, type LucideIcon } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import {
  ACRES_PER_HECTARE,
  acresAndGuntas,
  convertArea,
  groupIndian,
  toAcres,
} from "@/lib/format";
import type { AreaUnit } from "@/lib/types";
import { colors, font, radius, space } from "@/theme/tokens";
import { Label, Text } from "@/ui/text";

import { CountUp, useInView } from "./in-view";

const HUE = {
  green: "#0F6E56",
  blue: "#3B6FD8",
  amber: "#EF9F27",
  mint: "#5DCAA5",
} as const;

type Row = {
  key: string;
  label: string;
  hint: string;
  value: number;
  decimals: number;
  unit: string;
  icon: LucideIcon;
  hue: string;
};

/**
 * Declared area in Karnataka units: acres as the headline (with the acres + guntas reading),
 * then guntas, square feet and cents, each counting up when the card scrolls into view.
 * 1 acre = 40 guntas = 100 cents = 43,560 sq ft; 1 gunta = 33 × 33 ft = 1,089 sq ft.
 */
export function AreaConverter({
  value,
  unit,
}: {
  value: number;
  unit: AreaUnit;
}) {
  const { ref, seen, onLayout } = useInView();
  const acres = toAcres(value, unit);
  const split = acresAndGuntas(acres);
  const hectares = acres / ACRES_PER_HECTARE;
  const fractional = split.guntas > 0 && split.acres > 0;

  const rows: Row[] = [
    {
      key: "gunta",
      label: "Guntas",
      hint: "40 guntas = 1 acre",
      value: convertArea(value, unit, "gunta"),
      decimals: 2,
      unit: "gu",
      icon: Grid2x2,
      hue: HUE.green,
    },
    {
      key: "sqft",
      label: "Square feet",
      hint: "1 gunta = 33 × 33 ft",
      value: Math.round(convertArea(value, unit, "sqft")),
      decimals: 0,
      unit: "sq ft",
      icon: Scan,
      hue: HUE.blue,
    },
    {
      key: "cent",
      label: "Cents",
      hint: "100 cents = 1 acre",
      value: convertArea(value, unit, "cent"),
      decimals: 2,
      unit: "ct",
      icon: Ruler,
      hue: HUE.amber,
    },
  ];

  return (
    <Animated.View ref={ref} onLayout={onLayout} style={styles.card}>
      <View style={styles.head}>
        <Label>Area</Label>
        <Label>{`≈ ${groupIndian(hectares, 2)} ha`}</Label>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroFigure}>
          <CountUp value={acres} decimals={2} seen={seen} style={styles.huge} />
          <Text variant="bodyStrong" tone="secondary" style={styles.heroUnit}>
            {acres === 1 ? "acre" : "acres"}
          </Text>
        </View>
        {fractional ? (
          <Text variant="captionStrong" tone="secondary">
            {`${groupIndian(split.acres)} ${split.acres === 1 ? "acre" : "acres"} ${groupIndian(split.guntas, 2)} ${
              split.guntas === 1 ? "gunta" : "guntas"
            }`}
          </Text>
        ) : null}
      </View>

      <View style={styles.rows}>
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <View key={r.key} style={styles.row}>
              <View
                style={[styles.iconCircle, { backgroundColor: `${r.hue}1F` }]}
              >
                <Icon size={17} color={r.hue} strokeWidth={2.2} />
              </View>
              <View style={styles.rowText}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {r.label}
                </Text>
                <Text variant="caption" tone="tertiary" numberOfLines={1}>
                  {r.hint}
                </Text>
              </View>
              <View style={styles.rowFigure}>
                <CountUp
                  value={r.value}
                  decimals={r.decimals}
                  seen={seen}
                  delay={120 + i * 90}
                  style={styles.figure}
                  align="right"
                />
                <Text variant="caption" tone="secondary">
                  {r.unit}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[5],
    gap: space[4],
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(16,32,28,0.05)",
    boxShadow: "0 12px 32px rgba(16,32,28,0.08)",
  },
  head: { flexDirection: "row", justifyContent: "space-between" },
  hero: { gap: 2 },
  heroFigure: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  huge: {
    fontFamily: font.semibold,
    fontSize: 48,
    lineHeight: 54,
    letterSpacing: -1.8,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  heroUnit: { fontSize: 17 },
  rows: { gap: space[3] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 44,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, minWidth: 0 },
  rowFigure: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  figure: {
    fontFamily: font.semibold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
});
