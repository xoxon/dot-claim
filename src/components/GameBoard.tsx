import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';

import { PLAYER_COLOR, RIVAL_COLOR } from '../game/engine';
import type { Dot, Edge, Triangle } from '../game/types';

type Props = {
  dots: Dot[];
  edges: Edge[];
  triangles: Triangle[];
  selectedDotId: string | null;
  disabled: boolean;
  size: number;
  onDotPress: (id: string) => void;
};

const DOT_SIZE = 38;

export function GameBoard({ dots, edges, triangles, selectedDotId, disabled, size, onDotPress }: Props) {
  const byId = new Map(dots.map((dot) => [dot.id, dot]));
  const at = (dot: Dot) => ({ x: (dot.x / 100) * size, y: (dot.y / 100) * size });

  return (
    <View style={[styles.board, { width: size, height: size }]} accessible accessibilityLabel="Oyun tahtası">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {triangles.map((triangle) => {
          const triangleDots = triangle.dots.map((id) => byId.get(id)).filter((dot): dot is Dot => Boolean(dot));
          if (triangleDots.length !== 3) return null;
          const points = triangleDots.map((dot) => {
            const point = at(dot);
            return `${point.x},${point.y}`;
          }).join(' ');
          return <Polygon key={triangle.id} points={points} fill={triangle.owner === 'player' ? PLAYER_COLOR : RIVAL_COLOR} fillOpacity={0.18} />;
        })}
        {edges.map((edge) => {
          const a = byId.get(edge.a);
          const b = byId.get(edge.b);
          if (!a || !b) return null;
          const start = at(a);
          const end = at(b);
          return <Line key={edge.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={edge.owner === 'player' ? PLAYER_COLOR : RIVAL_COLOR} strokeWidth={5} strokeLinecap="round" />;
        })}
        {dots.map((dot) => {
          const point = at(dot);
          return <Circle key={`glow-${dot.id}`} cx={point.x} cy={point.y} r={selectedDotId === dot.id ? 22 : 15} fill={dot.color} opacity={selectedDotId === dot.id ? 0.28 : 0.12} />;
        })}
      </Svg>
      {dots.map((dot) => {
        const point = at(dot);
        const selected = dot.id === selectedDotId;
        return (
          <Pressable
            key={dot.id}
            accessibilityRole="button"
            accessibilityLabel={`${dot.id.replace('dot-', '')}. renkli nokta${selected ? ', seçili' : ''}`}
            accessibilityHint="Bağlantı çizmek için önce bir, sonra başka bir nokta seçin"
            disabled={disabled}
            onPress={() => onDotPress(dot.id)}
            style={({ pressed }) => [
              styles.dotHitbox,
              { left: point.x - DOT_SIZE / 2, top: point.y - DOT_SIZE / 2 },
              selected && styles.selectedDotHitbox,
              pressed && !disabled && styles.dotPressed,
            ]}
          >
            <View style={[styles.dot, { backgroundColor: dot.color }, selected && styles.selectedDot]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    alignSelf: 'center',
    borderRadius: 30,
    backgroundColor: '#0E2035',
    borderWidth: 1,
    borderColor: '#28445E',
    overflow: 'hidden',
  },
  dotHitbox: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: DOT_SIZE / 2,
  },
  selectedDotHitbox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#F7FBFF',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  selectedDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
  },
  dotPressed: {
    transform: [{ scale: 0.9 }],
  },
});
