// nes-helper-linux.c — Linux input helper for the Companion NES surface module.
//
// Reads Nintendo NES-style Switch controllers via the kernel `hid-nintendo`
// driver (evdev) and prints newline-delimited JSON events to stdout — the same
// protocol the macOS helper speaks, so the Node surface module is unchanged.
//
// Protocol (one JSON object per line):
//   {"type":"ready"}
//   {"type":"add","id":"B8:78:26:1A:DD:A5","side":"L","name":"NES Controller (L)"}
//   {"type":"remove","id":"B8:78:26:1A:DD:A5"}
//   {"type":"button","id":"B8:78:26:1A:DD:A5","button":"A","pressed":true}
//
// Buttons emitted: Up Down Left Right A B L R Select Start
//
// Identity = the controller's Bluetooth address (evdev EVIOCGUNIQ); side (L/R)
// from the device name. Each controller is its own /dev/input/eventX node;
// hotplug is handled via inotify on /dev/input.
//
// Build (on the target, no external deps):
//   gcc -O2 nes-helper-linux.c -o nes-helper-linux-<arch>     (arch: arm64 | x64)
//
// Requires kernel >= 6.8 (hid-nintendo NES support) and read access to
// /dev/input/event* (the `input` group). Linux only.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <poll.h>
#include <sys/inotify.h>
#include <sys/ioctl.h>
#include <linux/input.h>

#define NINTENDO_VENDOR 0x057E
#define MAX_DEVS 8

typedef struct {
    int fd;
    char path[288];
    char id[64];     // Bluetooth address (uniq)
    char side;       // 'L' / 'R' / '?'
    int hatx, haty;  // last D-pad hat state (-1/0/+1)
    int added;       // whether we emitted "add"
} Dev;

static Dev devs[MAX_DEVS];
static int ndevs = 0;

static int test_bit(const unsigned long *arr, int bit) {
    return (arr[bit / (8 * sizeof(long))] >> (bit % (8 * sizeof(long)))) & 1;
}

static void emit_add(const Dev *d, const char *name) {
    printf("{\"type\":\"add\",\"id\":\"%s\",\"side\":\"%c\",\"name\":\"%s\"}\n",
           d->id, d->side, name);
}
static void emit_remove(const char *id) {
    printf("{\"type\":\"remove\",\"id\":\"%s\"}\n", id);
}
static void emit_button(const char *id, const char *button, int pressed) {
    printf("{\"type\":\"button\",\"id\":\"%s\",\"button\":\"%s\",\"pressed\":%s}\n",
           id, button, pressed ? "true" : "false");
}

static const char *key_to_button(int code) {
    switch (code) {
        case BTN_SOUTH:  return "A";
        case BTN_EAST:   return "B";
        case BTN_TL:     return "L";
        case BTN_TR:     return "R";
        case BTN_SELECT: return "Select";
        case BTN_START:  return "Start";
        default:         return NULL;
    }
}

static int already_open(const char *path) {
    for (int i = 0; i < ndevs; i++)
        if (strcmp(devs[i].path, path) == 0) return 1;
    return 0;
}

// Try to open an event node; if it's an NES controller gamepad, register it.
static void try_add(const char *path) {
    if (ndevs >= MAX_DEVS || already_open(path)) return;

    int fd = open(path, O_RDONLY | O_NONBLOCK);
    if (fd < 0) return;

    struct input_id iid;
    if (ioctl(fd, EVIOCGID, &iid) < 0 || iid.vendor != NINTENDO_VENDOR) { close(fd); return; }

    // Must be the button (gamepad) node, not an IMU/motion node.
    unsigned long keybits[(KEY_MAX / (8 * sizeof(long))) + 1];
    memset(keybits, 0, sizeof(keybits));
    if (ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(keybits)), keybits) < 0 ||
        !test_bit(keybits, BTN_SOUTH)) { close(fd); return; }

    char name[256] = {0};
    ioctl(fd, EVIOCGNAME(sizeof(name) - 1), name);
    char uniq[64] = {0};
    ioctl(fd, EVIOCGUNIQ(sizeof(uniq) - 1), uniq);

    Dev *d = &devs[ndevs++];
    d->fd = fd;
    snprintf(d->path, sizeof(d->path), "%s", path);
    snprintf(d->id, sizeof(d->id), "%s", uniq[0] ? uniq : name);
    d->side = strstr(name, "(L)") ? 'L' : (strstr(name, "(R)") ? 'R' : '?');
    d->hatx = d->haty = 0;
    d->added = 1;
    emit_add(d, name[0] ? name : "NES Controller");
    fflush(stdout);
}

static void remove_dev(int idx) {
    Dev *d = &devs[idx];
    if (d->added) emit_remove(d->id);
    close(d->fd);
    devs[idx] = devs[--ndevs];   // compact
    fflush(stdout);
}

// Translate a D-pad hat axis change into press/release of the two directions.
static void handle_hat(Dev *d, int is_x, int value) {
    int prev = is_x ? d->hatx : d->haty;
    const char *neg = is_x ? "Left" : "Up";
    const char *pos = is_x ? "Right" : "Down";
    if (prev < 0 && value >= 0) emit_button(d->id, neg, 0);
    if (prev > 0 && value <= 0) emit_button(d->id, pos, 0);
    if (value < 0 && prev >= 0) emit_button(d->id, neg, 1);
    if (value > 0 && prev <= 0) emit_button(d->id, pos, 1);
    if (is_x) d->hatx = value; else d->haty = value;
}

static void read_dev(int idx) {
    struct input_event ev;
    ssize_t n;
    Dev *d = &devs[idx];
    while ((n = read(d->fd, &ev, sizeof(ev))) == sizeof(ev)) {
        if (ev.type == EV_KEY) {
            if (ev.value == 2) continue;             // ignore autorepeat
            const char *b = key_to_button(ev.code);
            if (b) { emit_button(d->id, b, ev.value ? 1 : 0); fflush(stdout); }
        } else if (ev.type == EV_ABS) {
            if (ev.code == ABS_HAT0X) { handle_hat(d, 1, ev.value); fflush(stdout); }
            else if (ev.code == ABS_HAT0Y) { handle_hat(d, 0, ev.value); fflush(stdout); }
        }
    }
    if (n < 0 && (errno == ENODEV || errno == EBADF)) remove_dev(idx);  // unplugged
}

static void scan_existing(void) {
    DIR *dir = opendir("/dev/input");
    if (!dir) return;
    struct dirent *e;
    while ((e = readdir(dir))) {
        if (strncmp(e->d_name, "event", 5) != 0) continue;
        char path[288];
        snprintf(path, sizeof(path), "/dev/input/%s", e->d_name);
        try_add(path);
    }
    closedir(dir);
}

int main(void) {
    setvbuf(stdout, NULL, _IOLBF, 0);

    int ino = inotify_init1(IN_NONBLOCK);
    if (ino >= 0) inotify_add_watch(ino, "/dev/input", IN_CREATE | IN_ATTRIB | IN_DELETE);

    scan_existing();
    printf("{\"type\":\"ready\"}\n");
    fflush(stdout);

    for (;;) {
        struct pollfd pfds[MAX_DEVS + 2];
        int nf = 0;
        // stdin: exit on EOF (parent/module went away)
        pfds[nf].fd = 0; pfds[nf].events = POLLIN; nf++;
        int ino_idx = -1;
        if (ino >= 0) { pfds[nf].fd = ino; pfds[nf].events = POLLIN; ino_idx = nf; nf++; }
        int dev_start = nf;
        for (int i = 0; i < ndevs; i++) { pfds[nf].fd = devs[i].fd; pfds[nf].events = POLLIN; nf++; }

        if (poll(pfds, nf, -1) < 0) { if (errno == EINTR) continue; break; }

        if (pfds[0].revents & (POLLIN | POLLHUP)) {     // stdin
            char buf[256];
            ssize_t r = read(0, buf, sizeof(buf));
            if (r <= 0) break;                          // EOF -> exit
        }
        if (ino_idx >= 0 && (pfds[ino_idx].revents & POLLIN)) {
            char buf[4096];
            ssize_t len = read(ino, buf, sizeof(buf));
            for (ssize_t off = 0; off >= 0 && off < len; ) {
                struct inotify_event *iev = (struct inotify_event *)(buf + off);
                if (iev->len && strncmp(iev->name, "event", 5) == 0) {
                    char path[288];
                    snprintf(path, sizeof(path), "/dev/input/%s", iev->name);
                    try_add(path);   // new node appeared (controller connected)
                }
                off += sizeof(struct inotify_event) + iev->len;
            }
        }
        // Iterate backwards so remove_dev's compaction is safe.
        for (int i = ndevs - 1; i >= 0; i--) {
            int pi = dev_start + i;
            if (pi < nf && (pfds[pi].revents & (POLLIN | POLLERR | POLLHUP)))
                read_dev(i);
        }
    }
    return 0;
}
