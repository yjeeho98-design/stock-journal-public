import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { BookOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

function JournalForm({
  initial,
  onSuccess,
  trigger,
}: {
  initial?: { id: number; title?: string | null; content: string; entryDate: Date; tags?: string | null };
  onSuccess: () => void;
  trigger: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    content: initial?.content ?? "",
    tags: initial?.tags ?? "",
    entryDate: initial?.entryDate
      ? new Date(initial.entryDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  });

  const createMutation = trpc.journal.create.useMutation({
    onSuccess: () => {
      toast.success("일기가 저장되었습니다.");
      utils.journal.list.invalidate();
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error("저장 실패: " + err.message),
  });

  const updateMutation = trpc.journal.update.useMutation({
    onSuccess: () => {
      toast.success("수정되었습니다.");
      utils.journal.list.invalidate();
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error("수정 실패: " + err.message),
  });

  function handleSubmit() {
    if (!form.content.trim()) {
      toast.error("내용을 입력해주세요.");
      return;
    }
    const payload = {
      title: form.title || undefined,
      content: form.content,
      tags: form.tags || undefined,
      entryDate: new Date(form.entryDate),
    };
    if (initial) {
      updateMutation.mutate({ id: initial.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle>{initial ? "일기 수정" : "투자일기 작성"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">날짜</Label>
              <Input type="date" value={form.entryDate} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} className="bg-input border-border" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">제목 (선택)</Label>
              <Input placeholder="제목..." value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="bg-input border-border" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">내용 (마크다운 지원)</Label>
            <Textarea
              placeholder="오늘의 투자 근거, 시장 분석, 계획 등을 자유롭게 기록하세요..."
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              className="bg-input border-border min-h-48 font-mono text-sm resize-none"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">태그 (쉼표 구분, 선택)</Label>
            <Input placeholder="AAPL, 정기투자, 분석..." value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} className="bg-input border-border" />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {initial ? "수정하기" : "저장하기"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Journal() {
  const utils = trpc.useUtils();
  const { data: entries, isLoading } = trpc.journal.list.useQuery();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const deleteMutation = trpc.journal.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.journal.list.invalidate();
    },
    onError: (err) => toast.error("삭제 실패: " + err.message),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[900px]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">투자일기</h1>
            <p className="text-sm text-muted-foreground mt-1">매매 근거와 투자 계획을 기록하세요</p>
          </div>
          <JournalForm
            onSuccess={() => {}}
            trigger={
              <Button size="sm" className="gap-1.5">
                <Plus className="w-4 h-4" />
                일기 작성
              </Button>
            }
          />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-card rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !entries?.length ? (
          <Card className="bg-card border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <BookOpen className="w-8 h-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-lg">투자일기가 없습니다</p>
                <p className="text-muted-foreground text-sm mt-1">
                  첫 번째 투자일기를 작성해 보세요.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const tags = entry.tags?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];

              return (
                <Card
                  key={entry.id}
                  className="bg-card border-border/50 hover:border-border transition-colors cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1.5">
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatDate(entry.entryDate)}
                          </span>
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        {entry.title && (
                          <p className="font-semibold text-base mb-1">{entry.title}</p>
                        )}
                        {!isExpanded && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {entry.content}
                          </p>
                        )}
                        {isExpanded && (
                          <div
                            className="prose prose-sm prose-invert max-w-none mt-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Streamdown>{entry.content}</Streamdown>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <JournalForm
                          initial={entry as any}
                          onSuccess={() => {}}
                          trigger={
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm("삭제하시겠습니까?")) deleteMutation.mutate({ id: entry.id });
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
