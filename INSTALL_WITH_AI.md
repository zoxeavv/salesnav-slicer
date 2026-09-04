# Prompt d’installation pour une IA

Copiez-collez le prompt ci-dessous dans Claude Code ou Codex.

```text
Installe le skill public `salesnav-slicer` depuis :
https://github.com/zoxeavv/salesnav-slicer

Objectif : rendre le même skill disponible dans Claude Code et Codex avec une
seule copie canonique. Ne supprime et n’écrase aucun fichier existant.

1. Inspecte d’abord ces deux emplacements :
   - Codex : ~/.agents/skills/salesnav-slicer
   - Claude Code : ~/.claude/skills/salesnav-slicer
2. Si aucun n’existe, clone le repository dans
   ~/.agents/skills/salesnav-slicer, puis crée un lien symbolique depuis
   ~/.claude/skills/salesnav-slicer vers cette copie.
3. Si une installation existe déjà et pointe vers ce même repository, conserve
   les éventuelles modifications locales et utilise uniquement un
   `git pull --ff-only` lorsqu’il peut réussir sans les écraser.
4. Si un emplacement contient autre chose ou si la mise à jour n’est pas un
   fast-forward propre, arrête-toi et indique précisément le conflit. Ne le
   remplace pas.
5. N’installe aucun package : ne lance pas `npm install`. Le skill n’utilise ni
   Cargo, ni token API, ni extension de navigateur.
6. Vérifie ensuite que `SKILL.md` est lisible depuis les deux emplacements, puis
   exécute depuis la copie canonique :
   - `npm test`
   - `npm run dogfood`
7. Termine par un readback contenant : le chemin canonique, les deux chemins de
   découverte, le commit Git installé, le nombre de tests réussis et toute
   limite restante. Ne déclare pas l’installation réussie sans ces preuves.

Après installation :
- dans Codex, le skill s’invoque avec `$salesnav-slicer` ;
- dans Claude Code, il s’invoque avec `/salesnav-slicer`.
```
