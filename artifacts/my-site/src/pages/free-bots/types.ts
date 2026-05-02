export type BotConfig = {
    id:          string;
    name:        string;
    emoji:       string;
    description: string;
    market:      string;
    strategy:    string;
    params:      { label: string; value: string }[];
    xmlPath:     string;
    gradient:    string;
    signalKey?:  string;
    v2Enabled?:  boolean;
};
