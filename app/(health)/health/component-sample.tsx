"use client";

// One of each shadcn base component, for side-by-side comparison with the
// legacy screens (colour, radius, spacing). Internal page only.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ComponentSample() {
  return (
    <Card data-testid="component-sample">
      <CardHeader>
        <CardTitle>Base components</CardTitle>
        <CardDescription>Rendered from the legacy design tokens.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="sample-button">Primary</Button>
          <Button variant="outline">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Badge>Badge</Badge>
          <Badge variant="secondary">Secondary</Badge>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sample-input">Label</Label>
          <Input id="sample-input" data-testid="sample-input" placeholder="Input" />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Sample row</TableCell>
              <TableCell>Active</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="self-start">
              Open dialog
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog</DialogTitle>
              <DialogDescription>Sample dialog content.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
