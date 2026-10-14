import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { ApiClient } from "./api";
import { enqueue, newId, readQueue } from "./offline-queue";

type Element = { key: string; label: string; inspectionStatus: string | null; limitationReason: string | null; version: number | null; photos: number };
type Section = { key: string; label: string; elements: Element[] };
type Room = { id: string; floor: string; name: string; lengthM: number | null; widthM: number | null };
type Capture = { job: { id: string; reference: string }; survey: { id: string; status: string; editable: boolean } | null; sections?: Section[]; rooms?: Room[] };
const statuses = [["inspected", "Inspected"], ["not_inspected", "Not inspected"], ["inaccessible", "Inaccessible"], ["not_applicable", "Not applicable"]] as const;
const floors = [["ground", "Ground"], ["first", "First"], ["second", "Second"], ["lower_ground", "Lower ground"], ["roof_space", "Roof space"], ["outbuilding", "Outbuilding"]] as const;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * On-site capture for one assigned job. Every action is saved to the device first
 * and sent when there is signal. Field answers and report wording stay in the full
 * survey workspace; this records what is seen and measured on site.
 */
export function CaptureScreen({ jobId, address, scope, api, onBack, onQueued }: { jobId: string; address: string; scope: string; api: ApiClient; onBack: () => void; onQueued: () => void }) {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [room, setRoom] = useState({ floor: "ground", name: "", length: "", width: "" });
  const [minutes, setMinutes] = useState("");
  const [local, setLocal] = useState<Record<string, { status?: string; photos: number }>>({});

  const load = useCallback(async () => {
    try { setCapture(await api.get(`/api/mobile/jobs/${jobId}/capture`)); setMessage(""); }
    catch (error) { setMessage(`${(error as Error).message} Showing what this device already has.`); }
  }, [api, jobId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const pending = useMemo(() => readQueue(scope).filter((item) => ("surveyId" in item && item.surveyId === capture?.survey?.id) || ("jobId" in item && item.jobId === jobId)).length, [scope, capture, jobId, local]);
  const survey = capture?.survey;

  async function queue(item: Parameters<typeof enqueue>[1], photoUri?: string, done = "Saved on this device. It will sync when you have signal.") {
    try { await enqueue(scope, item, photoUri); setMessage(done); onQueued(); }
    catch (error) { setMessage(`Could not save on this device: ${(error as Error).message}`); }
  }
  async function setStatus(section: Section, element: Element, status: string) {
    if (!survey) return;
    if ((status === "inaccessible" || status === "not_inspected") && reason.trim().length < 3) { setMessage("Add a short reason (for example: loft hatch painted shut) before marking it not inspected."); return; }
    await queue({ kind: "sync", surveyId: survey.id, label: `${element.label}: ${status.replace("_", " ")}`, operations: [{ type: "set_element", operationId: newId("op"), element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, inspectionStatus: status, limitationReason: status === "inspected" || status === "not_applicable" ? null : reason.trim(), baseVersion: element.version }] });
    setLocal((value) => ({ ...value, [`${section.key}.${element.key}`]: { ...value[`${section.key}.${element.key}`], photos: value[`${section.key}.${element.key}`]?.photos ?? 0, status } })); setReason("");
  }
  async function addNote(section: Section, element: Element) {
    if (!survey || note.trim().length < 2) return;
    await queue({ kind: "sync", surveyId: survey.id, label: `Note on ${element.label}`, operations: [{ type: "add_observation", operationId: newId("op"), element: { sectionKey: section.key, elementKey: element.key, locationLabel: "" }, kind: "current_observation", text: note.trim(), observedAt: new Date().toISOString() }] });
    setNote("");
  }
  async function photo(section: Section, element: Element) {
    if (!survey) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { Alert.alert("Camera access needed", "Allow camera access in your device settings to take survey photos."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, exif: false });
    if (result.canceled || !result.assets[0]) return;
    const clientGeneratedId = `media_${newId("p").replace(/[^a-z0-9]/g, "").slice(0, 40)}`;
    await queue({ kind: "photo", surveyId: survey.id, label: `Photo of ${element.label}`, file: "", metadata: { clientGeneratedId, capturedAt: new Date().toISOString(), sectionKey: section.key, elementKey: element.key, ...(note.trim() ? { note: note.trim() } : {}) } }, result.assets[0].uri, "Photo saved on this device. It will upload when you have signal.");
    setLocal((value) => ({ ...value, [`${section.key}.${element.key}`]: { ...value[`${section.key}.${element.key}`], photos: (value[`${section.key}.${element.key}`]?.photos ?? 0) + 1 } })); setNote("");
  }
  async function addRoom() {
    if (!survey || room.name.trim().length < 1) { setMessage("Name the room first."); return; }
    const metres = (value: string) => value.trim() ? Math.round(Number(value.replace(",", ".")) * 100) / 100 : null;
    const lengthM = metres(room.length), widthM = metres(room.width);
    if ([lengthM, widthM].some((value) => value !== null && (!Number.isFinite(value) || value <= 0 || value > 500))) { setMessage("Enter dimensions in metres, for example 4.25."); return; }
    await queue({ kind: "room", surveyId: survey.id, label: `Room: ${room.name.trim()}`, body: { floor: room.floor, name: room.name.trim(), lengthM, widthM } });
    setRoom({ ...room, name: "", length: "", width: "" });
  }
  async function logTime() {
    const value = Math.round(Number(minutes));
    if (!Number.isFinite(value) || value < 1 || value > 1440) { setMessage("Enter minutes on site, for example 150."); return; }
    await queue({ kind: "cost", jobId, label: `${value} minutes on site`, body: { kind: "time", occurredOn: today(), minutes: value, description: "On site" } });
    setMinutes("");
  }

  return <View style={styles.wrap}>
    <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.link}>← Today’s jobs</Text></Pressable>
    <Text style={styles.eyebrow}>{capture?.job.reference ?? "JOB"} · SITE CAPTURE</Text>
    <Text style={styles.heading}>{address}</Text>
    <Text style={styles.body}>{pending ? `${pending} change${pending === 1 ? "" : "s"} waiting to sync from this device.` : "Everything on this device has synced."}</Text>
    {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}
    {capture && !survey ? <View style={styles.card}><Text style={styles.title}>No survey started</Text><Text style={styles.body}>Start the survey for this job in the Surveynt workspace. Site capture appears here once it exists.</Text></View> : null}
    {survey && !survey.editable ? <View style={styles.card}><Text style={styles.body}>This survey is {survey.status.replace("_", " ")}. Reopen it in the workspace to capture more.</Text></View> : null}
    {survey?.editable ? <>
      {capture?.sections?.map((section) => <View key={section.key} style={styles.card}>
        <Text style={styles.title}>{section.label}</Text>
        {section.elements.map((element) => { const id = `${section.key}.${element.key}`, state = local[id], status = state?.status ?? element.inspectionStatus; return <View key={element.key} style={styles.element}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === id }} onPress={() => setOpen(open === id ? null : id)} style={styles.elementHead}>
            <Text style={styles.elementName}>{element.label}</Text>
            <Text style={[styles.chip, status === "inspected" ? styles.chipOk : status ? styles.chipWarn : null]}>{status ? status.replace("_", " ") : "To do"}{element.photos + (state?.photos ?? 0) ? ` · ${element.photos + (state?.photos ?? 0)} photo${element.photos + (state?.photos ?? 0) === 1 ? "" : "s"}` : ""}</Text>
          </Pressable>
          {open === id ? <View style={styles.actions}>
            <View style={styles.row}>{statuses.map(([value, label]) => <Pressable key={value} accessibilityRole="button" style={[styles.pill, status === value ? styles.pillActive : null]} onPress={() => void setStatus(section, element, value)}><Text style={[styles.pillText, status === value ? styles.pillTextActive : null]}>{label}</Text></Pressable>)}</View>
            <TextInput style={styles.input} placeholder="Reason if not inspected (e.g. no safe access)" value={reason} onChangeText={setReason} />
            <TextInput style={[styles.input, styles.multiline]} multiline placeholder="What you see (saved as a site note)" value={note} onChangeText={setNote} />
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => void photo(section, element)}><Text style={styles.buttonText}>Take photo</Text></Pressable>
              <Pressable style={[styles.button, styles.secondary]} disabled={note.trim().length < 2} onPress={() => void addNote(section, element)}><Text style={styles.secondaryText}>Save note</Text></Pressable>
            </View>
          </View> : null}
        </View>; })}
      </View>)}
      <View style={styles.card}>
        <Text style={styles.title}>Rooms and measurements</Text>
        {capture?.rooms?.map((item) => <Text key={item.id} style={styles.body}>{item.name} · {item.lengthM && item.widthM ? `${item.lengthM} × ${item.widthM} m` : "not measured"}</Text>)}
        <View style={styles.row}>{floors.map(([value, label]) => <Pressable key={value} style={[styles.pill, room.floor === value ? styles.pillActive : null]} onPress={() => setRoom({ ...room, floor: value })}><Text style={[styles.pillText, room.floor === value ? styles.pillTextActive : null]}>{label}</Text></Pressable>)}</View>
        <TextInput style={styles.input} placeholder="Room name" value={room.name} onChangeText={(name) => setRoom({ ...room, name })} />
        <View style={styles.row}><TextInput style={[styles.input, styles.half]} placeholder="Length m" keyboardType="decimal-pad" value={room.length} onChangeText={(length) => setRoom({ ...room, length })} /><TextInput style={[styles.input, styles.half]} placeholder="Width m" keyboardType="decimal-pad" value={room.width} onChangeText={(width) => setRoom({ ...room, width })} /></View>
        <Pressable style={styles.button} onPress={() => void addRoom()}><Text style={styles.buttonText}>Add room</Text></Pressable>
      </View>
    </> : null}
    <View style={styles.card}>
      <Text style={styles.title}>Time on site</Text>
      <TextInput style={styles.input} placeholder="Minutes" keyboardType="number-pad" value={minutes} onChangeText={setMinutes} />
      <Pressable style={[styles.button, styles.secondary]} onPress={() => void logTime()}><Text style={styles.secondaryText}>Log time</Text></Pressable>
    </View>
    <Pressable onPress={() => void load()}><Text style={styles.link}>Refresh from Surveynt</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.3, color: "#637695" },
  heading: { fontSize: 24, fontWeight: "700", color: "#16233a", letterSpacing: -0.6 },
  title: { fontSize: 17, fontWeight: "600", color: "#16233a" },
  body: { fontSize: 14, lineHeight: 21, color: "#637695" },
  notice: { fontSize: 14, lineHeight: 21, color: "#16233a", backgroundColor: "#eaf1ff", padding: 12 },
  card: { backgroundColor: "white", borderColor: "#dce5f2", borderWidth: 1, padding: 18, gap: 10 },
  element: { borderTopWidth: 1, borderTopColor: "#eef2f8", paddingTop: 10, gap: 8 },
  elementHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 44 },
  elementName: { flex: 1, fontSize: 15, color: "#16233a", fontWeight: "500" },
  chip: { fontSize: 12, color: "#637695", backgroundColor: "#f2f5fa", paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  chipOk: { color: "#15825e", backgroundColor: "#e7f6ef" },
  chipWarn: { color: "#a76209", backgroundColor: "#fff4dc" },
  actions: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { borderWidth: 1, borderColor: "#dce5f2", paddingHorizontal: 12, paddingVertical: 9, minHeight: 40 },
  pillActive: { borderColor: "#2455dc", backgroundColor: "#eaf1ff" },
  pillText: { fontSize: 13, color: "#16233a" },
  pillTextActive: { fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#dce5f2", padding: 12, fontSize: 16, color: "#16233a" },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  half: { flex: 1, minWidth: 120 },
  button: { backgroundColor: "#2455dc", paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", minHeight: 46 },
  buttonText: { color: "white", fontWeight: "600" },
  secondary: { backgroundColor: "white", borderWidth: 1, borderColor: "#2455dc" },
  secondaryText: { color: "#2455dc", fontWeight: "600" },
  link: { color: "#2455dc", fontSize: 14, fontWeight: "600", paddingVertical: 8 },
});
