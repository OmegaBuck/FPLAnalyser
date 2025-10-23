import os
import requests
from flask import Flask, request, jsonify, render_template
from thefuzz import process

# By default, Flask looks for templates in a 'templates' folder.
# Since your index.html is in the root directory alongside app.py,
# we explicitly tell Flask to look in the current directory ('.') for templates.
# We also tell it the static files are in the root directory (static_folder='.')
# and should be served from the root URL path (static_url_path='').
app = Flask(__name__, template_folder='.', static_folder='.', static_url_path='')

# --- FPL Data Handling ---
FPL_API_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/'
fpl_data = None
fixtures_data = None

def fetch_fpl_data():
    """Fetches and caches the main FPL bootstrap data."""
    global fpl_data
    if fpl_data is None:
        try:
            response = requests.get(FPL_API_URL)
            response.raise_for_status()
            fpl_data = response.json()
            print("FPL data fetched and cached.")
        except requests.RequestException as e:
            print(f"Error fetching FPL data: {e}")
            return None
    return fpl_data

def fetch_fixtures_data():
    """Fetches and caches the FPL fixtures data."""
    global fixtures_data
    if fixtures_data is None:
        try:
            response = requests.get("https://fantasy.premierleague.com/api/fixtures/")
            response.raise_for_status()
            fixtures_data = response.json()
            print("FPL fixtures data fetched and cached.")
        except requests.RequestException as e:
            print(f"Error fetching FPL fixtures data: {e}")
            return None
    return fixtures_data

# --- Core Logic ---

def get_club_logo_url(team_id, teams_data):
    """Constructs the club logo URL for a given team ID."""
    for team in teams_data:
        if team['id'] == team_id:
            # The 'code' property corresponds to the team's badge image ID.
            team_code = team['code']
            return f"https://resources.premierleague.com/premierleague/badges/70/t{team_code}.png"
    return "" # Return empty string if team not found

def get_player_face_url(player):
    """Constructs the face URL for a player, with a placeholder for missing photos."""
    # Use a generic portrait placeholder for missing photos.
    placeholder_url = "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"
    if not player or 'photo' not in player or not player['photo']:
        return placeholder_url
    
    photo_id = player['photo'].replace('.jpg', '')
    if not photo_id.isdigit():
        return placeholder_url
        
    return f"https://resources.premierleague.com/premierleague/photos/players/40x40/p{photo_id}.png"

def calculate_player_score(player, fixture_difficulty=3):
    """
    Calculates a weighted score for a player, adjusted for fixture difficulty.
    Fixture difficulty is 1 (easy) to 5 (hard).
    """
    base_score = (float(player.get('form', 0.0)) * 0.6) + (float(player.get('points_per_game', 0.0)) * 0.4)
    
    # Map difficulty to a modifier. An easy fixture boosts the score, a hard one reduces it.
    difficulty_modifiers = {1: 1.2, 2: 1.1, 3: 1.0, 4: 0.9, 5: 0.8}
    modifier = difficulty_modifiers.get(fixture_difficulty, 1.0)
    
    return base_score * modifier

def rate_team(starting_players_with_difficulty, captain_id):
    """Rates a team based on a weighted score, including fixture difficulty."""
    if not starting_players_with_difficulty:
        return 0

    # starting_players_with_difficulty is a list of tuples: (player_object, difficulty)
    total_score = 0
    for p, d in starting_players_with_difficulty:
        player_score = calculate_player_score(p, d)
        # Double the captain's score
        if p.get('id') == captain_id:
            total_score += player_score * 2
        else:
            total_score += player_score
    
    # Let's define a "max" score for a world-class player.
    # e.g., form=8, ppg=8 -> score = (8*0.6)+(8*0.4) = 4.8+3.2 = 8
    # Max score for a starting XI of 11 world-class players, with one captained.
    max_possible_score = (10 * 8.0) + (1 * 8.0 * 2) # 10 players + 1 captain

    if max_possible_score == 0:
        return 0
        
    # We cap the rating at 100.
    rating = min(100, (total_score / max_possible_score) * 100)
    return round(rating)

def get_player_fixture_difficulty(player_team_id, gameweek_id, all_fixtures):
    """Finds a team's next fixture and returns its difficulty score (1-5)."""
    if not all_fixtures or not gameweek_id:
        return 3 # Default to neutral if data is unavailable

    for fixture in all_fixtures:
        if fixture['event'] == gameweek_id:
            if fixture['team_h'] == player_team_id:
                return fixture['team_h_difficulty']
            if fixture['team_a'] == player_team_id:
                return fixture['team_a_difficulty']
    return 3 # Default to neutral difficulty if fixture not found for some reason

def suggest_replacements(team_players_with_difficulty, all_elements, all_teams, all_fixtures, next_gameweek_id):
    """Suggests upgrades based on fixture-adjusted scores."""
    if not team_players_with_difficulty:
        return []

    # Sort players by their fixture-adjusted score, ascending, to show worst players first.
    team_players_with_difficulty.sort(key=lambda x: calculate_player_score(x[0], x[1]))
    
    suggestions = []
    team_player_ids = {p['id'] for p, d in team_players_with_difficulty}

    # Iterate through every player in the user's squad
    for player_to_replace, difficulty_to_replace in team_players_with_difficulty:
        current_price = player_to_replace['now_cost']
        position = player_to_replace['element_type']
        player_to_replace_score = calculate_player_score(player_to_replace, difficulty_to_replace)
        
        # Find all potential replacements that are a clear upgrade
        candidates = []
        for p in all_elements:
            if p['element_type'] == position and p['id'] not in team_player_ids:
                candidate_difficulty = get_player_fixture_difficulty(p['team'], next_gameweek_id, all_fixtures)
                candidate_score = calculate_player_score(p, candidate_difficulty)
                if p['now_cost'] <= current_price and candidate_score > player_to_replace_score:
                    # Store the candidate and their calculated score to avoid recalculating
                    candidates.append((p, candidate_score))
        
        # If there are any candidates, find the one with the best score
        if candidates:
            # Sort candidates by their pre-calculated fixture-adjusted score
            candidates.sort(key=lambda x: x[1], reverse=True)
            best_replacement, best_replacement_score = candidates[0]
            
            # Add this suggestion to the list
            suggestions.append({
                'out': player_to_replace['web_name'],
                'out_club_logo_url': get_club_logo_url(player_to_replace.get('team'), all_teams),
                'out_face_url': get_player_face_url(player_to_replace),
                'in': best_replacement['web_name'],
                'in_club_logo_url': get_club_logo_url(best_replacement.get('team'), all_teams),
                'in_face_url': get_player_face_url(best_replacement),
                'reason': f"Better fixture-adjusted score ({best_replacement_score:.1f} vs {player_to_replace_score:.1f}) for a similar or lower price.",
                'score_gain': best_replacement_score - player_to_replace_score,
                'in_player_object': best_replacement
            })
            
    return suggestions
    
def suggest_chips(starting_players_with_difficulty, bench_players_with_difficulty, other_suggestions, used_chips):
    """Analyzes the team and fixtures to suggest when to use FPL chips."""
    chip_suggestions = []

    # 1. Bench Boost Suggestion
    if not used_chips.get('benchBoost') and bench_players_with_difficulty:
        bench_scores = [calculate_player_score(p, d) for p, d in bench_players_with_difficulty]
        total_bench_score = sum(bench_scores)
        # Suggest if the total expected score from the bench is high (e.g., > 15 points)
        if total_bench_score > 15:
            chip_suggestions.append({
                'chip': 'Bench Boost',
                'reason': f"Your bench has a strong projected score of **{total_bench_score:.1f}**. This could be a great week to play your Bench Boost."
            })

    # 2. Triple Captain Suggestion
    if not used_chips.get('tripleCaptain') and starting_players_with_difficulty:
        # Find the best captain candidate
        captain_candidate = max(starting_players_with_difficulty, key=lambda x: calculate_player_score(x[0], x[1]))
        captain_player, captain_difficulty = captain_candidate
        captain_score = calculate_player_score(captain_player, captain_difficulty)
        # Suggest if the top player has an exceptionally high score (e.g., > 8.5)
        if captain_score > 8.5:
            chip_suggestions.append({
                'chip': 'Triple Captain',
                'reason': f"**{captain_player.get('web_name')}** has an outstanding fixture-adjusted score of **{captain_score:.1f}**. This is a prime opportunity for a Triple Captain."
            })

    # 3. Wildcard Suggestion
    # Suggest if there are many potential transfers, indicating a weak overall squad structure.
    # We check against total suggestions (top transfer + other suggestions)
    if not used_chips.get('wildcard') and len(other_suggestions) >= 5: # Wildcard logic is based on 'wildcard' key
        chip_suggestions.append({
            'chip': 'Wildcard',
            'reason': f"We've identified **{len(other_suggestions) + 1} potential upgrades** for your team. This might be a good time to use your Wildcard for a major overhaul."
        })
        
    # 4. Free Hit Suggestion
    # Suggest if there's a significant score difference between starters and potential replacements
    # This is a simple heuristic; a more complex one could look at DGWs, etc.
    if not used_chips.get('freeHit') and other_suggestions and other_suggestions[0].get('score_gain', 0) > 3.0:
        chip_suggestions.append({
            'chip': 'Free Hit',
            'reason': "There are significant one-week gains available. A Free Hit could maximize your points for this gameweek."
        })
    return chip_suggestions

def suggest_wildcard_team(all_elements, all_teams, all_fixtures, next_gameweek_id):
    """Builds the best possible 15-man squad within budget using a greedy value-based algorithm."""
    all_players_with_value = []
    for p in all_elements:
        difficulty = get_player_fixture_difficulty(p.get('team'), next_gameweek_id, all_fixtures)
        score = calculate_player_score(p, difficulty)
        # We will sort by score directly to prioritize performance over value for a wildcard.
        all_players_with_value.append({'player': p, 'score': score})

    # Sort all players by their fixture-adjusted score to find the best performers.
    all_players_with_value.sort(key=lambda x: x['score'], reverse=True)

    # Build the best squad using a greedy algorithm
    wildcard_squad = []
    budget = 100.0
    pos_counts = {1: 0, 2: 0, 3: 0, 4: 0}
    pos_limits = {1: 2, 2: 5, 3: 5, 4: 3}
    team_counts = {}
    team_limit = 3

    for p_data in all_players_with_value:
        if len(wildcard_squad) == 15:
            break
        
        player = p_data['player']
        pos = player['element_type']
        price = player['now_cost'] / 10.0
        team_id = player['team']

        # Enforce the 3-players-per-team rule
        if team_counts.get(team_id, 0) >= team_limit:
            continue

        if pos_counts[pos] < pos_limits[pos] and budget >= price:
            wildcard_squad.append(p_data)
            budget -= price
            pos_counts[pos] += 1
            team_counts[team_id] = team_counts.get(team_id, 0) + 1
    
    # Now, select the best starting XI from this wildcard squad
    gkp = sorted([p for p in wildcard_squad if p['player']['element_type'] == 1], key=lambda x: x['score'], reverse=True)
    defs = sorted([p for p in wildcard_squad if p['player']['element_type'] == 2], key=lambda x: x['score'], reverse=True)
    mids = sorted([p for p in wildcard_squad if p['player']['element_type'] == 3], key=lambda x: x['score'], reverse=True)
    fwds = sorted([p for p in wildcard_squad if p['player']['element_type'] == 4], key=lambda x: x['score'], reverse=True)

    # --- Select the best starting XI and bench from the 15-man squad ---
    starting_xi = []
    bench = []

    # 1. Pick starting GKP (best one) and bench GKP (second one)
    if gkp: starting_xi.append(gkp.pop(0))
    if gkp: bench.append(gkp.pop(0))

    # 2. Create a pool of all outfield players and sort by score
    outfield_pool = sorted(defs + mids + fwds, key=lambda x: x['score'], reverse=True)

    # 3. Select a valid formation with the best players (3 DEF, 2 MID, 1 FWD minimum)
    starting_xi.extend(outfield_pool[:3]) # Add top 3 outfielders (likely a mix)
    
    # 4. Fill remaining spots to make 11 starters, ensuring formation is valid
    # This is a simplified greedy approach. A more complex one could check all valid formations.
    # For now, we take the best remaining players to fill the XI.
    num_starters_needed = 11 - len(starting_xi)
    starting_xi.extend(outfield_pool[3:3+num_starters_needed])
    
    # 5. The rest of the outfield players go to the bench
    bench.extend(outfield_pool[3+num_starters_needed:])

    # 6. Format the final list for the frontend
    starting_xi.sort(key=lambda x: x['score'], reverse=True)
    final_lineup = []
    for i, p_data in enumerate(starting_xi):
        role = 'Starter'
        if i == 0: role = 'Captain'
        if i == 1: role = 'Vice-Captain'
        final_lineup.append({'player': p_data['player'], 'role': role})
    for p_data in bench:
        final_lineup.append({'player': p_data['player'], 'role': 'Sub'})    
        
    return final_lineup

# --- Flask Routes ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/players')
def get_all_players():
    """Provides a structured list of all players for the frontend."""
    all_fpl_data = fetch_fpl_data()
    if not all_fpl_data:
        return jsonify({'error': 'Could not fetch FPL data.'}), 500
    
    elements = all_fpl_data['elements']
    teams_data = all_fpl_data['teams']
    teams = {team['id']: team['short_name'] for team in all_fpl_data['teams']}
    
    # 1:GKP, 2:DEF, 3:MID, 4:FWD
    players_by_pos = {1: [], 2: [], 3: [], 4: []} 
    
    for p in elements:
        player_data = {
            'id': p['id'],
            'name': p['web_name'],
            'team': teams.get(p['team'], '???'),
            'team_id': p['team'],
            'price': p['now_cost'] / 10.0,
            'face_url': get_player_face_url(p),
            'club_logo_url': get_club_logo_url(p['team'], teams_data),
            'status': p.get('status', 'a'),
            'chance_of_playing': p.get('chance_of_playing_this_round'), # Can be null if 100
            'selected_by': p.get('selected_by_percent', '0.0')
        }
        players_by_pos[p['element_type']].append(player_data)
        
    # Sort players within each position by name
    for pos in players_by_pos:
        players_by_pos[pos].sort(key=lambda x: x['name'])
        
    return jsonify({
        'players': players_by_pos,
        'teams': teams_data
    })

@app.route('/analyze', methods=['POST'])
def analyze_team():
    data = request.get_json()
    if not data or 'starting_ids' not in data or 'bench_ids' not in data or 'captain_id' not in data:
        return jsonify({'error': 'Invalid request. Starting, bench, and captain IDs are required.'}), 400
    
    starting_ids = data['starting_ids']
    bench_ids = data['bench_ids']
    used_chips = data.get('usedChips', {}) # Changed 'used_chips' to 'usedChips' to match JS
    all_ids = starting_ids + bench_ids

    all_fpl_data = fetch_fpl_data()
    if not all_fpl_data:
        return jsonify({'error': 'Could not fetch FPL data from API.'}), 500
    
    all_fixtures = fetch_fixtures_data()
    if not all_fixtures:
        # Non-fatal, we can proceed with default difficulty
        print("Warning: Could not fetch fixtures data. Proceeding without fixture analysis.")

    # Create a map for quick lookups
    player_map = {p['id']: p for p in all_fpl_data['elements']}
    
    starting_players = [player_map[pid] for pid in starting_ids if pid in player_map]
    all_players = [player_map[pid] for pid in all_ids if pid in player_map]

    if len(all_players) != 15:
         return jsonify({
             'error': f'Analysis requires a full squad of 15 players. You provided {len(all_players)}.',
         }), 400
    
    if len(starting_players) != 11:
         return jsonify({
             'error': f'Analysis requires a starting XI of 11 players. You provided {len(starting_players)}.',
         }), 400

    # Find the next gameweek ID
    next_gameweek_id = None
    for event in all_fpl_data.get('events', []):
        if event.get('is_next'):
            next_gameweek_id = event.get('id')
            break

    # Get fixture difficulty for each player
    starting_players_with_difficulty = [
        (p, get_player_fixture_difficulty(p.get('team'), next_gameweek_id, all_fixtures)) for p in starting_players
    ]
    all_players_with_difficulty = [
        (p, get_player_fixture_difficulty(p.get('team'), next_gameweek_id, all_fixtures)) for p in all_players
    ]
    bench_players = [p for p in all_players if p['id'] not in starting_ids]
    bench_players_with_difficulty = [
        (p, get_player_fixture_difficulty(p.get('team'), next_gameweek_id, all_fixtures)) for p in bench_players
    ]

    team_rating = rate_team(starting_players_with_difficulty, data.get('captain_id'))
    suggestions = suggest_replacements(all_players_with_difficulty, all_fpl_data['elements'], all_fpl_data['teams'], all_fixtures, next_gameweek_id)

    # Sort suggestions by the highest score gain
    suggestions.sort(key=lambda x: x.get('score_gain', 0), reverse=True)

    # Split into the top 2 free transfers and other suggestions
    free_transfers = suggestions[:1] # Keep only the top suggestion as a "free transfer"
    other_suggestions = suggestions[1:]

    # Generate chip suggestions based on the analysis
    chip_suggestions = suggest_chips(starting_players_with_difficulty, bench_players_with_difficulty, other_suggestions, used_chips)

    # --- Generate Suggested Lineup ---
    suggested_lineup_ft = []
    if free_transfers:
        # Identify players to be transferred out and in
        out_player_names = {t['out'] for t in free_transfers}
        players_in = [t['in_player_object'] for t in free_transfers]

        # Create the new 15-player squad post-transfers
        current_squad_players = [p for p, d in all_players_with_difficulty]
        players_kept = [p for p in current_squad_players if p.get('web_name') not in out_player_names]
        new_squad_players = players_kept + players_in

        # Calculate fixture-adjusted scores for the new squad
        new_squad_with_scores = []
        for p in new_squad_players:
            difficulty = get_player_fixture_difficulty(p.get('team'), next_gameweek_id, all_fixtures)
            score = calculate_player_score(p, difficulty)
            new_squad_with_scores.append({'player': p, 'score': score})

        # Separate players by position and sort by score
        gkp = sorted([p for p in new_squad_with_scores if p['player']['element_type'] == 1], key=lambda x: x['score'], reverse=True)
        defs = sorted([p for p in new_squad_with_scores if p['player']['element_type'] == 2], key=lambda x: x['score'], reverse=True)
        mids = sorted([p for p in new_squad_with_scores if p['player']['element_type'] == 3], key=lambda x: x['score'], reverse=True)
        fwds = sorted([p for p in new_squad_with_scores if p['player']['element_type'] == 4], key=lambda x: x['score'], reverse=True)

        # Select the best starting XI based on formation rules and scores
        starting_xi = []
        outfield_pool = []

        if gkp: starting_xi.append(gkp.pop(0))
        starting_xi.extend(defs[:3]); outfield_pool.extend(defs[3:])
        starting_xi.extend(mids[:2]); outfield_pool.extend(mids[2:])
        starting_xi.extend(fwds[:1]); outfield_pool.extend(fwds[1:])

        # Fill remaining 4 spots with best outfield players
        outfield_pool.sort(key=lambda x: x['score'], reverse=True)
        starting_xi.extend(outfield_pool[:4])
        
        # The rest form the bench (GKP first, then others sorted by score)
        bench = gkp + sorted(outfield_pool[4:], key=lambda x: x['score'], reverse=True)
        
        # Format the final list for the frontend
        # The highest scoring player is captain, second highest is vice-captain
        starting_xi.sort(key=lambda x: x['score'], reverse=True)
        
        for i, p_data in enumerate(starting_xi):
            role = 'Starter'
            if i == 0: role = 'Captain'
            if i == 1: role = 'Vice-Captain'
            suggested_lineup_ft.append({'player': p_data['player'], 'role': role})
        for p_data in bench: suggested_lineup_ft.append({'player': p_data['player'], 'role': 'Sub'})

    # --- Generate Wildcard Lineup if suggested ---
    suggested_lineup_wc = []
    is_wildcard_suggested = any(c['chip'] == 'Wildcard' for c in chip_suggestions)
    if is_wildcard_suggested:
        suggested_lineup_wc = suggest_wildcard_team(
            all_fpl_data['elements'], all_fpl_data['teams'], all_fixtures, next_gameweek_id
        )
        
    # --- Generate Gameweek Fixtures List ---
    gameweek_fixtures = []
    if all_fixtures and next_gameweek_id:
        teams_map = {team['id']: team['name'] for team in all_fpl_data.get('teams', [])}
        for fixture in all_fixtures:
            if fixture.get('event') == next_gameweek_id:
                gameweek_fixtures.append({
                    'home_team_id': fixture.get('team_h'),
                    'home_team_name': teams_map.get(fixture.get('team_h'), 'N/A'),
                    'away_team_id': fixture.get('team_a'),
                    'away_team_name': teams_map.get(fixture.get('team_a'), 'N/A'),
                })
    gameweek_fixtures.sort(key=lambda x: x['home_team_name'])

    team_details = []
    for p in all_players:
        team_details.append({
            'name': p.get('web_name', 'N/A'),
            'form': p.get('form', '0.0'),
            'price': p.get('now_cost', 0) / 10.0,
            'points': p.get('total_points', 0),
            'role': 'Starter' if p.get('id') in starting_ids else 'Sub'
        })
    team_details.sort(key=lambda x: (x['role'] != 'Starter', x['name']))

    return jsonify({
        'team_rating': team_rating,
        'free_transfers': free_transfers,
        'other_suggestions': other_suggestions,
        'chip_suggestions': chip_suggestions,
        'identified_team': team_details,
        'gameweek_fixtures': gameweek_fixtures,
        'suggested_lineup_ft': [
            {
                'name': p_info['player'].get('web_name', 'N/A'),
                'form': p_info['player'].get('form', '0.0'),
                'price': p_info['player'].get('now_cost', 0) / 10.0,
                'points': p_info['player'].get('total_points', 0),
                'role': p_info['role']
            } for p_info in suggested_lineup_ft
        ],
        'suggested_lineup_wc': [
            {
                'name': p_info['player'].get('web_name', 'N/A'),
                'form': p_info['player'].get('form', '0.0'),
                'price': p_info['player'].get('now_cost', 0) / 10.0,
                'points': p_info['player'].get('total_points', 0),
                'role': p_info['role']
            } for p_info in suggested_lineup_wc
        ]
    })

if __name__ == '__main__':
    fetch_fpl_data() # Pre-fetch data on startup
    fetch_fixtures_data() # Pre-fetch fixtures on startup
    app.run(debug=True, port=5001)