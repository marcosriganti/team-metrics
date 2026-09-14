import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MetricItem {
  label: string;
  value: string | number;
  unit?: string;
}

interface MetricsCardProps {
  title: string;
  metrics: MetricItem[];
}

export function MetricsCard({ title, metrics }: MetricsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="space-y-1">
              <p className="text-sm text-muted-foreground">{metric.label}</p>
              <p className="text-2xl font-bold">
                {metric.value}
                {metric.unit && (
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    {metric.unit}
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
